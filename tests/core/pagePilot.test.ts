import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPreviewScript, clearPreviewScripts, removePreviewScript } from '../../src/core/pagePilot.ts';
import type { TemporaryScript } from '../../src/shared/types';

const loggerMock = vi.hoisted(() => {
  const mock: any = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  mock.child = vi.fn(() => mock);
  return mock;
});

vi.mock('../../src/core/logger.ts', () => ({
  logger: loggerMock,
}));

const buildScript = (overrides: Partial<TemporaryScript> = {}): TemporaryScript => ({
  id: overrides.id ?? `script-${Math.random().toString(36).slice(2, 10)}`,
  createdAt: overrides.createdAt ?? Date.now(),
  updatedAt: overrides.updatedAt ?? Date.now(),
  name: overrides.name,
  selector: overrides.selector ?? '#target',
  context: overrides.context ?? {
    url: 'https://example.test',
    title: 'Example',
  },
  script: overrides.script ?? {
    jsCode: '',
    cssCode: undefined,
  },
  status: overrides.status ?? 'pending',
  errorMessage: overrides.errorMessage,
});

describe('pagePilot preview lifecycle', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="target"></div>';
    loggerMock.warn.mockClear();
    clearPreviewScripts();
  });

  afterEach(() => {
    clearPreviewScripts();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('attaches css styles and removes them on revoke', async () => {
    const script = buildScript({
      id: 'css-only',
      script: { jsCode: '', cssCode: '#target { color: rgb(255, 0, 0); }' },
    });

    await applyPreviewScript(script);

    const style = document.querySelector<HTMLStyleElement>('style[data-pagepilot-script-id="css-only"]');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('rgb(255, 0, 0)');

    removePreviewScript(script.id);

    const removedStyle = document.querySelector<HTMLStyleElement>('style[data-pagepilot-script-id="css-only"]');
    expect(removedStyle).toBeNull();
  });

  it('invokes registered cleanup callbacks when script is revoked', async () => {
    const target = document.querySelector('#target');
    const script = buildScript({
      id: 'cleanup-test',
      script: {
        cssCode: undefined,
        jsCode: `
          context.elements.forEach((el) => el.classList.add('preview-active'));
          context.registerCleanup(() => {
            context.elements.forEach((el) => el.classList.remove('preview-active'));
          });
        `,
      },
    });

    await applyPreviewScript(script);

    expect(target?.classList.contains('preview-active')).toBe(true);

    removePreviewScript(script.id);

    expect(target?.classList.contains('preview-active')).toBe(false);
  });

  it('cleans up previous preview when re-applying the same script id', async () => {
    const target = document.querySelector('#target');
    (window as typeof window & { __cleanupRuns?: number }).__cleanupRuns = 0;

    const script = buildScript({
      id: 'reapply',
      script: {
        cssCode: 'body { outline: 1px solid green; }',
        jsCode: `
          context.registerCleanup(() => {
            window.__cleanupRuns = (window.__cleanupRuns ?? 0) + 1;
          });
          context.firstElement?.setAttribute('data-run', String((Number(context.firstElement?.getAttribute('data-run')) || 0) + 1));
        `,
      },
    });

    await applyPreviewScript(script);
    await applyPreviewScript(script);

    const styleElements = document.querySelectorAll('style[data-pagepilot-script-id="reapply"]');
    expect(styleElements).toHaveLength(1);
    expect((window as typeof window & { __cleanupRuns?: number }).__cleanupRuns).toBe(1);
    expect(target?.getAttribute('data-run')).toBe('2');
  });

  it('removes injected style if javascript execution fails', async () => {
    const script = buildScript({
      id: 'failure',
      script: {
        cssCode: '#target { background: pink; }',
        jsCode: 'throw new Error("preview failed")',
      },
    });

    await expect(applyPreviewScript(script)).rejects.toThrowError('preview failed');
    const leftoverStyle = document.querySelector<HTMLStyleElement>('style[data-pagepilot-script-id="failure"]');
    expect(leftoverStyle).toBeNull();
  });

  it('clears all previews and executes cleanup handlers', async () => {
    const target = document.querySelector('#target');
    const other = document.createElement('div');
    other.id = 'secondary';
    document.body.appendChild(other);

    const first = buildScript({
      id: 'first',
      selector: '#target',
      script: {
        cssCode: '#target { border: 1px solid blue; }',
        jsCode: `
          context.registerCleanup(() => {
            context.firstElement?.setAttribute('data-cleaned', 'true');
          });
        `,
      },
    });

    const second = buildScript({
      id: 'second',
      selector: '#secondary',
      script: {
        cssCode: '#secondary { border: 1px solid orange; }',
        jsCode: `
          context.registerCleanup(() => {
            context.firstElement?.remove();
          });
        `,
      },
    });

    await applyPreviewScript(first);
    await applyPreviewScript(second);

    expect(document.querySelectorAll('style[data-pagepilot-script-id]').length).toBe(2);

    clearPreviewScripts();

    expect(document.querySelectorAll('style[data-pagepilot-script-id]').length).toBe(0);
    expect(target?.getAttribute('data-cleaned')).toBe('true');
    expect(document.getElementById('secondary')).toBeNull();
  });

  it('swallows cleanup errors while logging a warning', async () => {
    const script = buildScript({
      id: 'cleanup-error',
      script: {
        jsCode: `
          context.registerCleanup(() => {
            throw new Error('cleanup failed');
          });
        `,
        cssCode: undefined,
      },
    });

    await applyPreviewScript(script);

    expect(() => removePreviewScript(script.id)).not.toThrow();
    expect(loggerMock.warn).toHaveBeenCalledWith('Cleanup for preview script threw an error.', expect.objectContaining({ scriptId: 'cleanup-error' }));
  });
});
