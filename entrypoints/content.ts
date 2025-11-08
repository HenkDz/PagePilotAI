import browser from 'webextension-polyfill';

import { logger } from '../src/core/logger';
import { applyPreviewScript, removePreviewScript } from '../src/core/pagePilot';
import { buildSelectorDescriptor, captureContextSnapshot } from '../src/core/selector';
import { RuntimeMessageType } from '../src/shared/messages';
import type { RuntimeMessage, TemporaryScript } from '../src/shared/types';

const log = logger.child('content');

let isCapturing = false;
let currentTarget: Element | null = null;
let overlay: HTMLDivElement | null = null;
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

  currentTarget = target;
  updateOverlay(target);
};

const finalizeCapture = async (element: Element) => {
  try {
    const descriptor = buildSelectorDescriptor(element);
    const context = captureContextSnapshot(element);

    await browser.runtime.sendMessage({
      type: RuntimeMessageType.SelectorCaptured,
      payload: { descriptor, context },
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
  currentTarget = null;
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
  currentTarget = null;
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

  log.debug('Selector capture stopped.');
};

const applyTemporaryScript = (script: TemporaryScript) => {
  applyPreviewScript(script);
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
      return Promise.resolve({ ok: true });
    case RuntimeMessageType.TempScriptExecute:
      try {
        const payload = message.payload as { script: TemporaryScript };
        const result = applyTemporaryScript(payload.script);
        return Promise.resolve(result);
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

    browser.runtime.onMessage.addListener((message: RuntimeMessage<RuntimeMessageType, unknown>) => {
      const result = handleRuntimeMessage(message);
      if (result) {
        return result;
      }
      return undefined;
    });
  },
});
