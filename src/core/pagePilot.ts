import { RuntimeMessageType } from '../shared/messages';
import { logger } from './logger';
import type { TemporaryScript } from '../shared/types';
import type { RuntimeResponse } from '../shared/types';
import type { TempScriptModuleCreateResult } from '../shared/messages';
type BrowserApi = typeof import('webextension-polyfill');

type CleanupHandler = () => void | Promise<void>;

interface PreviewEntry {
  id: string;
  selector: string;
  cleanup?: CleanupHandler;
  styleEl?: HTMLStyleElement;
}

const log = logger.child('page-pilot');

const previews = new Map<string, PreviewEntry>();

const browserApi: BrowserApi | undefined = (globalThis as typeof globalThis & { browser?: BrowserApi }).browser;

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

const fetchRemoteModule = async (scriptId: string, source: string) => {
  if (typeof browserApi?.runtime?.sendMessage !== 'function') {
    throw new Error('Extension messaging unavailable for module creation.');
  }

  const response = (await browserApi.runtime.sendMessage({
    type: RuntimeMessageType.TempScriptModuleCreate,
    payload: { scriptId, source },
  })) as RuntimeResponse<TempScriptModuleCreateResult>;

  if (!response?.ok || !response.payload?.url) {
    throw new Error(response?.error ?? 'Unable to prepare script module.');
  }

  const url = response.payload.url;

  try {
    const mod = await import(/* @vite-ignore */ url);
    if (typeof mod?.default !== 'function') {
      throw new Error('Generated script did not export a runnable function.');
    }
    return mod.default as (context: unknown) => unknown;
  } finally {
    try {
      await browserApi.runtime.sendMessage({
        type: RuntimeMessageType.TempScriptModuleRelease,
        payload: { scriptId },
      });
    } catch (releaseError) {
      log.debug('Module release message failed.', {
        scriptId,
        error: releaseError instanceof Error ? releaseError.message : String(releaseError),
      });
    }
  }
};

const loadModuleRunner = async (
  scriptId: string,
  source: string,
  moduleUrl?: string,
): Promise<(context: unknown) => unknown> => {
  const moduleSource = `export default async (context) => {\n${source}\n};`;

  if (moduleUrl) {
    try {
      const mod = await import(/* @vite-ignore */ moduleUrl);
      if (typeof mod?.default !== 'function') {
        throw new Error('Generated script did not export a runnable function.');
      }
      return mod.default as (context: unknown) => unknown;
    } catch (error) {
      log.warn('Module import via provided URL failed, falling back.', {
        scriptId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (typeof browserApi?.runtime?.sendMessage === 'function') {
    return fetchRemoteModule(scriptId, moduleSource);
  }

  log.debug('Extension messaging unavailable, using inline evaluation fallback.', {
    scriptId,
  });

  const legacyRunner = new Function('context', `'use strict';\n${source}`);
  return async (context: unknown) => legacyRunner(context);
};

const executeJs = async (
  scriptId: string,
  selector: string,
  jsCode: string | undefined,
  moduleUrl?: string,
): Promise<CleanupHandler | undefined> => {
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
    const runner = await loadModuleRunner(scriptId, jsCode, moduleUrl);
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

export const applyPreviewScript = async (
  script: TemporaryScript,
  options?: { moduleUrl?: string },
) => {
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
    const cleanup = await executeJs(script.id, script.selector, script.script.jsCode, options?.moduleUrl);

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
