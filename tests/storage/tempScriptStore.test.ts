import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemporaryScript } from '../../src/shared/types.js';

const indexedDbMocks = vi.hoisted(() => ({
  withStore: vi.fn(),
  requestToPromise: vi.fn(),
}));

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

vi.mock('../../src/storage/indexedDb.ts', () => ({
  withStore: indexedDbMocks.withStore,
  requestToPromise: indexedDbMocks.requestToPromise,
}));

const { withStore, requestToPromise } = indexedDbMocks;

const storageLocalMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: storageLocalMocks.get,
        set: storageLocalMocks.set,
      },
    },
  },
}));

const storageLocalGet = storageLocalMocks.get;
const storageLocalSet = storageLocalMocks.set;

import {
  listTemporaryScripts,
  removeTemporaryScript,
  saveTemporaryScript,
} from '../../src/storage/tempScriptStore.js';

const FALLBACK_KEY = 'pagepilot.tempScripts';

const createScript = (overrides: Partial<TemporaryScript> = {}): TemporaryScript => ({
  id: overrides.id ?? `script-${Math.random().toString(36).slice(2, 8)}`,
  createdAt: overrides.createdAt ?? Date.now(),
  updatedAt: overrides.updatedAt ?? Date.now(),
  selector: overrides.selector ?? '#target',
  context: overrides.context ?? {
    url: 'https://example.test',
    title: 'Example',
  },
  script: overrides.script ?? {
    jsCode: 'console.log("preview")',
  },
  status: overrides.status ?? 'pending',
  notes: overrides.notes,
  errorMessage: overrides.errorMessage,
});

describe('tempScriptStore', () => {
  beforeEach(() => {
    withStore.mockReset();
    requestToPromise.mockReset();
    storageLocalGet.mockReset();
    storageLocalSet.mockReset();

    loggerMock.warn.mockClear();
  });

  it('persists scripts via IndexedDB helpers', async () => {
    const stored: TemporaryScript[] = [];

    withStore.mockImplementation(async (_storeName, mode, handler) => {
      if (mode === 'readwrite') {
        return handler({
          put: (script: TemporaryScript) => Promise.resolve(stored.push(script) && undefined),
          delete: (_id: string) => {
            const index = stored.findIndex((item) => item.id === _id);
            if (index >= 0) {
              stored.splice(index, 1);
            }
            return Promise.resolve(undefined);
          },
        } as unknown as IDBObjectStore);
      }

      return handler({
        getAll: () => Promise.resolve(stored.slice()),
      } as unknown as IDBObjectStore);
    });

    requestToPromise.mockImplementation((request) => request);

    const script = createScript({ id: 'indexed-1', status: 'applied' });

    await saveTemporaryScript(script);
    const result = await listTemporaryScripts();

    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(script);
    expect(result).toEqual([script]);
  });

  it('falls back to browser.storage.local when IndexedDB write fails', async () => {
    withStore.mockRejectedValue(new Error('indexeddb not available'));

    let fallbackValue: TemporaryScript[] = [];
    storageLocalGet.mockResolvedValue({ [FALLBACK_KEY]: fallbackValue });
    storageLocalSet.mockImplementation(async (payload: Record<string, TemporaryScript[]>) => {
      fallbackValue = payload[FALLBACK_KEY] ?? [];
    });

    const script = createScript({ id: 'fallback-1' });
    await saveTemporaryScript(script);

    expect(storageLocalSet).toHaveBeenCalledWith({ [FALLBACK_KEY]: [script] });

    // When listing, force IndexedDB to throw again so we use fallback data.
    withStore.mockRejectedValue(new Error('indexeddb not available'));
    storageLocalGet.mockResolvedValue({ [FALLBACK_KEY]: fallbackValue });

    const result = await listTemporaryScripts();
    expect(result).toEqual([script]);
  });

  it('removes scripts through fallback when IndexedDB delete fails', async () => {
    const original = [createScript({ id: 'fallback-keep' }), createScript({ id: 'fallback-remove' })];
    let fallbackValue: TemporaryScript[] = original.slice();

    withStore.mockRejectedValue(new Error('blocked'));
    storageLocalGet.mockResolvedValue({ [FALLBACK_KEY]: fallbackValue.slice() });
    storageLocalSet.mockImplementation(async (payload: Record<string, TemporaryScript[]>) => {
      fallbackValue = payload[FALLBACK_KEY] ?? [];
    });

    await removeTemporaryScript('fallback-remove');

    const payload = storageLocalSet.mock.calls.at(-1)?.[0] as Record<string, TemporaryScript[]>;
    expect(payload[FALLBACK_KEY]).toHaveLength(1);
    expect(payload[FALLBACK_KEY][0].id).toBe('fallback-keep');
  });
});
