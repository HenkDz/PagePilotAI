import { logger } from './logger';
import type { TemporaryScript } from '../shared/types';
type CleanupHandler = () => void | Promise<void>;

interface PreviewEntry {
  id: string;
  selector: string;
  cleanup?: CleanupHandler;
  styleEl?: HTMLStyleElement;
}

declare global {
  interface Window {
    __pagepilotCleanups?: Map<string, CleanupHandler>;
  }
}

const log = logger.child('page-pilot');

const previews = new Map<string, PreviewEntry>();

// Ensure the global cleanup registry exists
const ensureCleanupRegistry = () => {
  if (!window.__pagepilotCleanups) {
    window.__pagepilotCleanups = new Map();
  }
  return window.__pagepilotCleanups;
};

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

/**
 * Apply a preview script. JS execution is now handled by background via chrome.scripting.executeScript.
 * This function only handles CSS injection and tracking.
 */
export const applyPreviewScript = async (
  script: TemporaryScript,
  _options?: { moduleUrl?: string },
) => {
  const existing = previews.get(script.id);
  if (existing) {
    // Run cleanup if registered
    const registry = ensureCleanupRegistry();
    const cleanup = registry.get(script.id) ?? existing.cleanup;
    if (cleanup) {
      try {
        await Promise.resolve(cleanup());
      } catch (error) {
        log.warn('Cleanup for preview script threw an error.', {
          scriptId: script.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      registry.delete(script.id);
    }
    existing.styleEl?.remove();
    previews.delete(script.id);
  }

  // CSS is applied here; JS is injected by background script
  const styleEl = attachStyle(script.id, script.script.cssCode);

  previews.set(script.id, {
    id: script.id,
    selector: script.selector,
    cleanup: undefined, // Cleanup will be registered via window.__pagepilotCleanups
    styleEl,
  });
};

export const removePreviewScript = (scriptId: string) => {
  const entry = previews.get(scriptId);
  
  // Always try to run cleanup from global registry
  const registry = ensureCleanupRegistry();
  const cleanup = registry.get(scriptId) ?? entry?.cleanup;
  
  if (cleanup) {
    try {
      void Promise.resolve(cleanup()).catch((error) => {
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
    registry.delete(scriptId);
  }

  if (entry) {
    entry.styleEl?.remove();
    previews.delete(scriptId);
  }
};

export const clearPreviewScripts = () => {
  Array.from(previews.keys()).forEach(removePreviewScript);
};

/**
 * Register a cleanup handler for a script (called from injected code).
 */
export const registerScriptCleanup = (scriptId: string, cleanup: CleanupHandler) => {
  const registry = ensureCleanupRegistry();
  registry.set(scriptId, cleanup);
};
