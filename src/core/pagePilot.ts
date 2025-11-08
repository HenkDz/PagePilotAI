import { logger } from './logger';
import type { TemporaryScript } from '../shared/types';

type CleanupHandler = () => void | Promise<void>;

interface PreviewEntry {
  id: string;
  selector: string;
  cleanup?: CleanupHandler;
  styleEl?: HTMLStyleElement;
}

const log = logger.child('page-pilot');

const previews = new Map<string, PreviewEntry>();

const attachStyle = (id: string, cssCode: string | undefined): HTMLStyleElement | undefined => {
  if (!cssCode) {
    return undefined;
  }

  const style = document.createElement('style');
  style.dataset.pagepilotScriptId = id;
  style.textContent = cssCode;
  const target = document.head ?? document.documentElement;
  target.appendChild(style);
  return style;
};

const loadModuleRunner = async (source: string): Promise<(context: unknown) => unknown> => {
  if (typeof URL.createObjectURL !== 'function' || typeof Blob === 'undefined') {
    // Fallback for environments (like unit tests) that do not expose blob URLs.
    const legacyRunner = new Function('context', `'use strict';\n${source}`);
    return async (context: unknown) => legacyRunner(context);
  }

  const moduleSource = `export default async (context) => {\n${source}\n};`;
  const blob = new Blob([moduleSource], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  try {
    const mod = await import(/* @vite-ignore */ url);
    if (typeof mod?.default !== 'function') {
      throw new Error('Generated script did not export a runnable function.');
    }
    return mod.default as (context: unknown) => unknown;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const executeJs = async (selector: string, jsCode: string | undefined): Promise<CleanupHandler | undefined> => {
  if (!jsCode?.trim()) {
    return undefined;
  }

  const elements = Array.from(document.querySelectorAll(selector));
  let cleanup: CleanupHandler | undefined;

  const context = {
    selector,
    elements,
    firstElement: elements[0] ?? null,
    registerCleanup: (callback: () => void | Promise<void>) => {
      if (typeof callback === 'function') {
        cleanup = callback;
      }
    },
    console,
    document,
    window,
  } as const;

  try {
    const runner = await loadModuleRunner(jsCode);
    const result = await runner(context);
    if (typeof result === 'function') {
      cleanup = result as CleanupHandler;
    }
  } catch (error) {
    log.warn('Preview script execution failed.', {
      selector,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return cleanup;
};

export const applyPreviewScript = async (script: TemporaryScript) => {
  const existing = previews.get(script.id);
  if (existing) {
    void Promise.resolve(existing.cleanup?.()).catch((error) => {
      log.warn('Cleanup for preview script threw an error.', {
        scriptId: script.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    existing.styleEl?.remove();
    previews.delete(script.id);
  }

  try {
    const styleEl = attachStyle(script.id, script.script.cssCode);
    const cleanup = await executeJs(script.selector, script.script.jsCode);

    previews.set(script.id, {
      id: script.id,
      selector: script.selector,
      cleanup,
      styleEl,
    });
  } catch (error) {
    const styleEl = document.querySelector<HTMLStyleElement>(`style[data-pagepilot-script-id="${script.id}"]`);
    styleEl?.remove();
    throw error;
  }
};

export const removePreviewScript = (scriptId: string) => {
  const entry = previews.get(scriptId);
  if (!entry) {
    return;
  }

  try {
    void Promise.resolve(entry.cleanup?.()).catch((error) => {
      log.warn('Cleanup for preview script threw an error.', {
        scriptId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    log.warn('Cleanup for preview script threw an error.', {
      scriptId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  entry.styleEl?.remove();
  previews.delete(scriptId);
};

export const clearPreviewScripts = () => {
  Array.from(previews.keys()).forEach(removePreviewScript);
};
