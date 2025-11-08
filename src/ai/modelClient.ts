import { defaultAiProviderConfig } from '../shared/env';
import type {
  GeneratedScriptPayload,
  ModelUsageStats,
  PageContextSnapshot,
  SelectorDescriptor,
} from '../shared/types';

export class ModelClientError extends Error {
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ModelClientError';
    this.status = status;
    this.details = details;
  }
}

export interface ModelClientConfig {
  baseUrl: string;
  apiKey?: string | null;
  model?: string;
  timeoutMs?: number;
  endpointPath?: string;
}

export interface GenerateScriptContext {
  selector?: SelectorDescriptor;
  page?: PageContextSnapshot;
  history?: string[];
}

export interface GenerateScriptParams {
  prompt: string;
  context?: GenerateScriptContext;
  temperature?: number;
  maxOutputTokens?: number;
  systemPrompt?: string;
  responseFormat?: 'json' | 'text';
  abortSignal?: AbortSignal;
}

export interface GenerateScriptResult {
  script: GeneratedScriptPayload;
  rawText: string;
  finishReason?: string;
  usage?: ModelUsageStats;
}

export interface ModelClient {
  generateScript(params: GenerateScriptParams): Promise<GenerateScriptResult>;
}

interface ModelClientDeps {
  fetch: typeof fetch;
  AbortController: typeof AbortController;
  now: () => number;
}

const DEFAULT_SYSTEM_PROMPT = `You are PagePilot, an assistant that writes small, idempotent client-side scripts to modify web pages on demand.
Always respond with JSON: { "jsCode": string, "cssCode"?: string, "urlMatchPattern"?: string }.
The JavaScript should avoid external dependencies and must rely on the provided DOM selector context.`;

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_ENDPOINT_PATH = 'chat/completions';

const defaultDeps: ModelClientDeps = {
  fetch: (globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined) as typeof fetch,
  AbortController: globalThis.AbortController
    ?? (class AbortControllerFallback {
      readonly signal = {} as AbortSignal;
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      abort(): void {}
    } as unknown as typeof AbortController),
  now: () => Date.now(),
};

const normaliseBaseUrl = (baseUrl: string): string => {
  if (!baseUrl?.trim()) {
    throw new ModelClientError('AI provider base URL is required.');
  }
  return baseUrl.trim().replace(/\/$/, '');
};

const buildEndpoint = (baseUrl: string, path: string | undefined): string => {
  const normalised = normaliseBaseUrl(baseUrl);
  const finalPath = (path ?? DEFAULT_ENDPOINT_PATH).trim();

  if (!finalPath) {
    throw new ModelClientError('Model endpoint path is empty.');
  }

  if (/^https?:\/\//i.test(finalPath)) {
    return finalPath;
  }

  const baseWithTrailingSlash = normalised.endsWith('/') ? normalised : `${normalised}/`;
  const relativePath = finalPath.startsWith('/') ? finalPath.slice(1) : finalPath;

  try {
    return new URL(relativePath, baseWithTrailingSlash).toString();
  } catch (error) {
    throw new ModelClientError('Failed to construct model endpoint URL.', undefined, error);
  }
};
const extractMessageContent = (rawContent: unknown): string | null => {
  if (typeof rawContent === 'string') {
    return rawContent;
  }

  if (Array.isArray(rawContent)) {
    const parts = rawContent
      .map((segment) => {
        if (!segment || typeof segment !== 'object') {
          return '';
        }
        const candidate = (segment as { text?: string; content?: string }).text
          ?? (segment as { text?: string; content?: string }).content;
        return typeof candidate === 'string' ? candidate : '';
      })
      .filter((value) => value.trim().length > 0);

    if (parts.length > 0) {
      const combined = parts.join('\n').trim();
      return combined.length > 0 ? combined : null;
    }
  }

  return null;
};

const buildUserMessage = (prompt: string, context?: GenerateScriptContext): string => {
  const segments: string[] = [];

  if (context?.selector) {
    const { selector, previewText, framePath } = context.selector;
    segments.push([
      'Selector context:',
      `selector: ${selector}`,
      previewText ? `preview: ${previewText}` : null,
      framePath?.length ? `frames: ${framePath.join(' > ')}` : null,
    ]
      .filter(Boolean)
      .join('\n'));
  }

  if (context?.page) {
    const { url, title } = context.page;
    segments.push([
      'Page context:',
      url ? `url: ${url}` : null,
      title ? `title: ${title}` : null,
    ]
      .filter(Boolean)
      .join('\n'));
  }

  if (context?.history?.length) {
    segments.push(['Previous attempts:', ...context.history].join('\n- '));
  }

  if (prompt.trim()) {
    segments.push(`Request:\n${prompt.trim()}`);
  }

  return segments.join('\n\n') || prompt.trim();
};

const parseScriptPayload = (content: string): GeneratedScriptPayload => {
  if (!content?.trim()) {
    return { jsCode: '' };
  }

  try {
    const parsed = JSON.parse(content);
    const jsCode = parsed.jsCode ?? parsed.js_code ?? '';
    const cssCode = parsed.cssCode ?? parsed.css_code;
    const urlMatchPattern = parsed.urlMatchPattern ?? parsed.url_match_pattern;

    if (typeof jsCode === 'string') {
      const payload: GeneratedScriptPayload = { jsCode };
      if (typeof cssCode === 'string' && cssCode.trim()) {
        payload.cssCode = cssCode;
      }
      if (typeof urlMatchPattern === 'string' && urlMatchPattern.trim()) {
        payload.urlMatchPattern = urlMatchPattern;
      }
      return payload;
    }
  } catch {
    // fall through to plain-text handling
  }

  return { jsCode: content };
};

const readResponseBody = async (response: Response): Promise<{ text: string; json?: unknown }> => {
  const text = await response.text();
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text };
  }
};

export const createModelClient = (
  config: ModelClientConfig,
  deps: ModelClientDeps = defaultDeps,
): ModelClient => {
  const endpoint = buildEndpoint(config.baseUrl, config.endpointPath);
  const model = config.model?.trim() || defaultAiProviderConfig.model;
  const timeoutMs = typeof config.timeoutMs === 'number' ? config.timeoutMs : DEFAULT_TIMEOUT_MS;

  if (!deps.fetch) {
    throw new ModelClientError('No fetch implementation available.');
  }

  if (!deps.AbortController) {
    throw new ModelClientError('No AbortController implementation available.');
  }

  const generateScript = async (params: GenerateScriptParams): Promise<GenerateScriptResult> => {
    const controller = new deps.AbortController();
    const handleAbortProxy = () => controller.abort();

    if (params.abortSignal) {
      if (params.abortSignal.aborted) {
        controller.abort();
      } else {
        params.abortSignal.addEventListener('abort', handleAbortProxy, { once: true });
      }
    }
    const abortTimer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

    try {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: params.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(params.prompt, params.context) },
        ],
        temperature: typeof params.temperature === 'number' ? params.temperature : 0.2,
      };

      if (typeof params.maxOutputTokens === 'number') {
        body.max_output_tokens = params.maxOutputTokens;
      }

      if (params.responseFormat === 'json') {
        body.response_format = { type: 'json_object' };
      }

      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };

      if (config.apiKey?.trim()) {
        headers.Authorization = `Bearer ${config.apiKey.trim()}`;
      }

      const response = await deps.fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const { text, json } = await readResponseBody(response);

      if (!response.ok) {
        const message =
          typeof (json as any)?.error?.message === 'string'
            ? (json as any).error.message
            : text || `Request failed with status ${response.status}`;
        throw new ModelClientError(message, response.status, json ?? text);
      }

      const payload = json as any;
      const choice = payload?.choices?.[0];
      const content = extractMessageContent(choice?.message?.content);

      if (!content) {
        throw new ModelClientError('Model response did not include completion text.', response.status, payload);
      }

      return {
        script: parseScriptPayload(content),
        rawText: content,
        finishReason: choice?.finish_reason,
        usage: payload?.usage,
      };
    } catch (error) {
      if (error instanceof ModelClientError) {
        throw error;
      }

      if ((error as Error).name === 'AbortError') {
        throw new ModelClientError('Model request timed out.', undefined, { timeoutMs });
      }

      throw new ModelClientError((error as Error)?.message ?? 'Unknown model client error.', undefined, error);
    } finally {
      if (abortTimer) {
        clearTimeout(abortTimer);
      }
      if (params.abortSignal) {
        params.abortSignal.removeEventListener('abort', handleAbortProxy);
      }
    }
  };

  return {
    generateScript,
  };
};

export const DEFAULT_MODEL_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
