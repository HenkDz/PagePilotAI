const manifest = typeof browser !== 'undefined' ? browser.runtime.getManifest() : undefined;

export const runtimeEnv = {
  mode: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
  version: manifest?.version ?? '0.0.0',
};

export const defaultAiProviderConfig = {
  baseUrl: import.meta.env.VITE_PAGEPILOT_AI_BASE_URL?.trim() ?? 'https://openrouter.ai/api/v1',
  model: import.meta.env.VITE_PAGEPILOT_AI_MODEL?.trim() ?? 'gpt-4o-mini',
};

export type DefaultAiProviderConfig = typeof defaultAiProviderConfig;
