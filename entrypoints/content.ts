import browser from 'webextension-polyfill';

import { logger } from '../src/core/logger';
import { applyPreviewScript, removePreviewScript } from '../src/core/pagePilot';
import { buildSelectorDescriptor, captureContextSnapshot, updateSelectorLevel, countMatches } from '../src/core/selector';
import { RuntimeMessageType } from '../src/shared/messages';
import type { RuntimeMessage, TemporaryScript, SelectorLevel, CapturedSelectorState } from '../src/shared/types';
import type { SelectorSetLevelPayload, SelectorHighlightPayload } from '../src/shared/messages';

const log = logger.child('content');

let isCapturing = false;
let capturedElement: Element | null = null;
let capturedState: CapturedSelectorState | null = null;
let overlay: HTMLDivElement | null = null;
let highlightOverlay: HTMLDivElement | null = null;
let previousCursor: string | null = null;

const ensureOverlay = (): HTMLDivElement => {
  if (overlay) {
    return overlay;
  }

  const highlight = document.createElement('div');
  highlight.id = 'pagepilot-selector-overlay';
  Object.assign(highlight.style, {
    position: 'fixed',
    pointerEvents: 'none',
    border: '2px solid #5b67f1',
    background: 'rgba(91, 103, 241, 0.24)',
    boxShadow: '0 0 12px rgba(91, 103, 241, 0.45)',
    borderRadius: '4px',
    zIndex: '2147483646',
    transition: 'all 80ms ease-out',
    opacity: '0',
  });

  const parent = document.body ?? document.documentElement;
  parent.appendChild(highlight);
  overlay = highlight;
  return highlight;
};

const ensureHighlightOverlay = (): HTMLDivElement => {
  if (highlightOverlay) {
    return highlightOverlay;
  }

  const container = document.createElement('div');
  container.id = 'pagepilot-highlight-container';
  Object.assign(container.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '2147483645',
  });

  const parent = document.body ?? document.documentElement;
  parent.appendChild(container);
  highlightOverlay = container;
  return container;
};

const updateOverlay = (target: Element | null) => {
  const highlight = ensureOverlay();

  if (!target) {
    highlight.style.opacity = '0';
    return;
  }

  const bounds = target.getBoundingClientRect();
  highlight.style.opacity = '1';
  highlight.style.top = `${bounds.top}px`;
  highlight.style.left = `${bounds.left}px`;
  highlight.style.width = `${bounds.width}px`;
  highlight.style.height = `${bounds.height}px`;
};

const highlightSelector = (selector: string) => {
  const container = ensureHighlightOverlay();
  container.innerHTML = '';

  try {
    const elements = document.querySelectorAll(selector);
    elements.forEach((el) => {
      const bounds = el.getBoundingClientRect();
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed',
        top: `${bounds.top}px`,
        left: `${bounds.left}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        border: '2px solid #f97316',
        background: 'rgba(249, 115, 22, 0.18)',
        borderRadius: '3px',
        pointerEvents: 'none',
        transition: 'all 100ms ease-out',
      });
      container.appendChild(box);
    });
  } catch (error) {
    log.debug('Failed to highlight selector.', {
      selector,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const clearHighlight = () => {
  if (highlightOverlay) {
    highlightOverlay.innerHTML = '';
  }
};

const stopEvent = (event: Event) => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
};

const handlePointerMove = (event: PointerEvent) => {
  if (!isCapturing) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (!target || overlay === target || overlay?.contains(target)) {
    return;
  }

  updateOverlay(target);
};

const finalizeCapture = async (element: Element) => {
  try {
    capturedElement = element;
    const descriptor = buildSelectorDescriptor(element, 'element');
    const context = captureContextSnapshot(element);
    capturedState = { descriptor, context };

    await browser.runtime.sendMessage({
      type: RuntimeMessageType.SelectorCaptured,
      payload: capturedState,
    });
  } catch (error) {
    log.error('Failed to relay captured selector.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const handleClick = (event: MouseEvent) => {
  if (!isCapturing) {
    return;
  }

  stopEvent(event);

  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return;
  }

  finalizeCapture(target).finally(stopCapture);
};

const handleKeydown = (event: KeyboardEvent) => {
  if (!isCapturing) {
    return;
  }

  if (event.key === 'Escape') {
    stopEvent(event);
    stopCapture();
  }
};

const startCapture = () => {
  if (isCapturing) {
    return;
  }

  isCapturing = true;
  ensureOverlay();

  previousCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';

  document.addEventListener('pointermove', handlePointerMove, true);
  document.addEventListener('pointerdown', stopEvent, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeydown, true);

  log.debug('Selector capture started.');
};

export const stopCapture = () => {
  if (!isCapturing) {
    return;
  }

  isCapturing = false;
  updateOverlay(null);

  document.removeEventListener('pointermove', handlePointerMove, true);
  document.removeEventListener('pointerdown', stopEvent, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeydown, true);

  if (overlay) {
    overlay.remove();
    overlay = null;
  }

  if (previousCursor !== null) {
    document.documentElement.style.cursor = previousCursor;
    previousCursor = null;
  } else {
    document.documentElement.style.removeProperty('cursor');
  }

  // Notify background so UI can update isCapturing state even when user cancels via Escape.
  void browser.runtime.sendMessage({
    type: RuntimeMessageType.SelectorCaptureStop,
    payload: {},
  });

  log.debug('Selector capture stopped.');
};

const handleSetLevel = async (payload: SelectorSetLevelPayload) => {
  if (!capturedState || !capturedElement) {
    return { ok: false, error: 'No element captured.' };
  }

  const level = payload.level as SelectorLevel;
  const customSelector = payload.customSelector;
  const classSelection = payload.classSelection;

  // Re-build descriptor with new level
  if (level === 'custom' && customSelector) {
    // Validate custom selector
    try {
      const matchCount = countMatches(customSelector);
      capturedState = {
        ...capturedState,
        descriptor: {
          ...capturedState.descriptor,
          selector: customSelector,
          level: 'custom',
          matchCount,
        },
      };
    } catch {
      return { ok: false, error: 'Invalid custom selector.' };
    }
  } else {
    const updatedDescriptor = updateSelectorLevel(capturedState.descriptor, level, {
      customSelector,
      classSelection,
    });
    capturedState = {
      ...capturedState,
      descriptor: updatedDescriptor,
    };
  }

  // Highlight all matches
  highlightSelector(capturedState.descriptor.selector);

  // Notify background of updated state
  try {
    await browser.runtime.sendMessage({
      type: RuntimeMessageType.SelectorCaptured,
      payload: capturedState,
    });
  } catch (error) {
    log.debug('Failed to broadcast updated selector.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { ok: true, payload: capturedState };
};

const handleHighlight = (payload: SelectorHighlightPayload) => {
  highlightSelector(payload.selector);
  return { ok: true };
};

const handleClearHighlight = () => {
  clearHighlight();
  return { ok: true };
};

const applyTemporaryScript = async (script: TemporaryScript) => {
  // CSS is handled here; JS is injected by background via chrome.scripting.executeScript
  await applyPreviewScript(script);
  return {
    ok: true,
  } as const;
};

const revokeTemporaryScript = (scriptId: string) => {
  removePreviewScript(scriptId);
  return {
    ok: true,
  } as const;
};

const handleRuntimeMessage = (
  message: RuntimeMessage<RuntimeMessageType, unknown>,
): Promise<unknown> | undefined => {
  switch (message.type) {
    case RuntimeMessageType.SelectorCaptureStart:
      startCapture();
      return Promise.resolve({ ok: true });
    case RuntimeMessageType.SelectorCaptureStop:
      stopCapture();
      clearHighlight();
      return Promise.resolve({ ok: true });
    case RuntimeMessageType.Ping:
      return Promise.resolve({ ok: true, payload: { timestamp: Date.now() } });
    case RuntimeMessageType.SelectorSetLevel:
      return handleSetLevel(message.payload as SelectorSetLevelPayload);
    case RuntimeMessageType.SelectorHighlight:
      return Promise.resolve(handleHighlight(message.payload as SelectorHighlightPayload));
    case RuntimeMessageType.SelectorClearHighlight:
      return Promise.resolve(handleClearHighlight());
    case RuntimeMessageType.TempScriptExecute:
      try {
        const payload = message.payload as { script: TemporaryScript };
        return applyTemporaryScript(payload.script).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          return { ok: false, error: reason };
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return Promise.resolve({ ok: false, error: reason });
      }
    case RuntimeMessageType.TempScriptRevoke:
      try {
        const payload = message.payload as { scriptId: string };
        const result = revokeTemporaryScript(payload.scriptId);
        return Promise.resolve(result);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return Promise.resolve({ ok: false, error: reason });
      }
    default:
      return undefined;
  }
};

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    log.debug('Content script ready.');

    browser.runtime.onMessage.addListener((message: unknown) => {
      const result = handleRuntimeMessage(message as RuntimeMessage<RuntimeMessageType, unknown>);
      if (result) {
        return result;
      }
      return undefined;
    });
  },
});
