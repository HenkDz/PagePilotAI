import browser from 'webextension-polyfill';

import { logger } from '../core/logger';
import { requestToPromise, withStore } from './indexedDb';
import type { AiProviderConfig, SettingKey, StoredSetting } from '../shared/types';
import { defaultAiProviderConfig } from '../shared/env';

const FALLBACK_KEY = 'pagepilot.settings';
const AI_PROVIDER_KEY: SettingKey = 'aiProviderConfig';

const log = logger.child('storage:settings');

const readIndexedDbSetting = async <TValue>(key: SettingKey): Promise<StoredSetting<TValue> | undefined> => {
  return withStore('settings', 'readonly', (store) => {
    const request = store.get(key);
    return requestToPromise(request) as Promise<StoredSetting<TValue> | undefined>;
  });
};

const writeIndexedDbSetting = async <TValue>(record: StoredSetting<TValue>): Promise<void> => {
  await withStore('settings', 'readwrite', (store) => {
    const request = store.put(record);
    return requestToPromise(request).then(() => undefined);
  });
};

const deleteIndexedDbSetting = async (key: SettingKey): Promise<void> => {
  await withStore('settings', 'readwrite', (store) => {
    const request = store.delete(key);
    return requestToPromise(request).then(() => undefined);
  });
};

const readFallbackSettings = async (): Promise<Record<string, unknown>> => {
  const result = await browser.storage.local.get(FALLBACK_KEY);
  const stored = result[FALLBACK_KEY];
  return stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
};

const writeFallbackSettings = async (settings: Record<string, unknown>): Promise<void> => {
  await browser.storage.local.set({ [FALLBACK_KEY]: settings });
};

const handleIndexedDbError = async <T>(
  error: unknown,
  operation: string,
  fallback: () => Promise<T>,
): Promise<T> => {
  log.warn(`IndexedDB ${operation} failed; falling back to browser.storage.local.`, {
    error: String(error),
  });
  return fallback();
};

export const loadAiProviderConfig = async (): Promise<AiProviderConfig> => {
  try {
    const stored = await readIndexedDbSetting<AiProviderConfig>(AI_PROVIDER_KEY);
    if (stored?.value) {
      return stored.value;
    }
  } catch (error) {
    const fallbackValue = await handleIndexedDbError(error, 'read settings', async () => {
      const settings = await readFallbackSettings();
      return settings[AI_PROVIDER_KEY] as AiProviderConfig | undefined;
    });
    if (fallbackValue) {
      return fallbackValue;
    }
  }

  return {
    baseUrl: defaultAiProviderConfig.baseUrl,
    apiKey: null,
    model: defaultAiProviderConfig.model,
  };
};

export const saveAiProviderConfig = async (config: AiProviderConfig): Promise<void> => {
  const record: StoredSetting<AiProviderConfig> = {
    key: AI_PROVIDER_KEY,
    value: config,
    updatedAt: Date.now(),
  };

  try {
    await writeIndexedDbSetting(record);
  } catch (error) {
    await handleIndexedDbError(error, 'write settings', async () => {
      const settings = await readFallbackSettings();
      settings[AI_PROVIDER_KEY] = config;
      await writeFallbackSettings(settings);
    });
  }
};

export const clearAiProviderConfig = async (): Promise<void> => {
  try {
    await deleteIndexedDbSetting(AI_PROVIDER_KEY);
  } catch (error) {
    await handleIndexedDbError(error, 'delete settings', async () => {
      const settings = await readFallbackSettings();
      delete settings[AI_PROVIDER_KEY];
      await writeFallbackSettings(settings);
    });
  }
};
