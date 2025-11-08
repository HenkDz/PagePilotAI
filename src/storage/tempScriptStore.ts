import browser from 'webextension-polyfill';

import { logger } from '../core/logger';
import { requestToPromise, withStore } from './indexedDb';
import type { TemporaryScript } from '../shared/types';

const FALLBACK_KEY = 'pagepilot.tempScripts';

const log = logger.child('storage:temp-scripts');

const readAllFromIndexedDb = async (): Promise<TemporaryScript[]> => {
  return withStore('tempScripts', 'readonly', (store) => {
    const request = store.getAll();
    return requestToPromise(request) as Promise<TemporaryScript[]>;
  });
};

const readFromIndexedDb = async (id: string): Promise<TemporaryScript | undefined> => {
  return withStore('tempScripts', 'readonly', (store) => {
    const request = store.get(id);
    return requestToPromise(request) as Promise<TemporaryScript | undefined>;
  });
};

const writeToIndexedDb = async (script: TemporaryScript): Promise<void> => {
  await withStore('tempScripts', 'readwrite', (store) => {
    const request = store.put(script);
    return requestToPromise(request).then(() => undefined);
  });
};

const deleteFromIndexedDb = async (id: string): Promise<void> => {
  await withStore('tempScripts', 'readwrite', (store) => {
    const request = store.delete(id);
    return requestToPromise(request).then(() => undefined);
  });
};

const clearIndexedDb = async (): Promise<void> => {
  await withStore('tempScripts', 'readwrite', (store) => {
    const request = store.clear();
    return requestToPromise(request).then(() => undefined);
  });
};

const readAllFromFallback = async (): Promise<TemporaryScript[]> => {
  const result = await browser.storage.local.get(FALLBACK_KEY);
  const scripts = (result[FALLBACK_KEY] ?? []) as TemporaryScript[];
  return Array.isArray(scripts) ? scripts : [];
};

const saveAllToFallback = async (scripts: TemporaryScript[]): Promise<void> => {
  await browser.storage.local.set({ [FALLBACK_KEY]: scripts });
};

const updateFallback = async (updater: (scripts: TemporaryScript[]) => TemporaryScript[]): Promise<void> => {
  const scripts = await readAllFromFallback();
  const updated = updater(scripts);
  await saveAllToFallback(updated);
};

const handleIndexedDbError = <T>(error: unknown, operation: string, fallback: () => Promise<T>): Promise<T> => {
  log.warn(`IndexedDB ${operation} failed; falling back to browser.storage.local.`, {
    error: String(error),
  });
  return fallback();
};

export const listTemporaryScripts = async (): Promise<TemporaryScript[]> => {
  try {
    return await readAllFromIndexedDb();
  } catch (error) {
    return handleIndexedDbError(error, 'readAll', readAllFromFallback);
  }
};

export const getTemporaryScript = async (id: string): Promise<TemporaryScript | undefined> => {
  try {
    return await readFromIndexedDb(id);
  } catch (error) {
    return handleIndexedDbError(error, 'read', async () => {
      const scripts = await readAllFromFallback();
      return scripts.find((item) => item.id === id);
    });
  }
};

export const saveTemporaryScript = async (script: TemporaryScript): Promise<void> => {
  try {
    await writeToIndexedDb(script);
  } catch (error) {
    await handleIndexedDbError(error, 'write', async () => {
      await updateFallback((scripts) => {
        const existingIndex = scripts.findIndex((item) => item.id === script.id);
        if (existingIndex >= 0) {
          const clone = scripts.slice();
          clone[existingIndex] = script;
          return clone;
        }
        return [...scripts, script];
      });
    });
  }
};

export const removeTemporaryScript = async (id: string): Promise<void> => {
  try {
    await deleteFromIndexedDb(id);
  } catch (error) {
    await handleIndexedDbError(error, 'delete', async () => {
      await updateFallback((scripts) => scripts.filter((item) => item.id !== id));
    });
  }
};

export const clearTemporaryScripts = async (): Promise<void> => {
  try {
    await clearIndexedDb();
  } catch (error) {
    await handleIndexedDbError(error, 'clear', async () => {
      await saveAllToFallback([]);
    });
  }
};
