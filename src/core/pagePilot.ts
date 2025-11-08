import { logger } from './logger';
import type { TemporaryScript } from '../shared/types';

interface PreviewEntry {
  id: string;
  selector: string;
  cleanup?: () => void;
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

const executeJs = (selector: string, jsCode: string | undefined): (() => void) | undefined => {
  if (!jsCode?.trim()) {
    return undefined;
  }

  const elements = Array.from(document.querySelectorAll(selector));
  let cleanup: (() => void) | undefined;

  const context = {
    selector,
    elements,
    firstElement: elements[0] ?? null,
    registerCleanup: (callback: () => void) => {
      if (typeof callback === 'function') {
        cleanup = callback;
      }
    },
    console,
    document,
    window,
  } as const;

  try {
    const runner = new Function('context', `'use strict';\n` + jsCode);
    runner(context);
  } catch (error) {
    log.warn('Preview script execution failed.', {
      selector,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return cleanup;
};

export const applyPreviewScript = (script: TemporaryScript) => {
  const existing = previews.get(script.id);
  if (existing) {
    existing.cleanup?.();
    existing.styleEl?.remove();
    previews.delete(script.id);
  }

  try {
    const styleEl = attachStyle(script.id, script.script.cssCode);
    const cleanup = executeJs(script.selector, script.script.jsCode);

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
    entry.cleanup?.();
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
