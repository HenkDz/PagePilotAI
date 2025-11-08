import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { GenerateScriptParams, ModelClientConfig } from '../../src/ai/modelClient.js';
import { DEFAULT_MODEL_SYSTEM_PROMPT, ModelClientError, createModelClient } from '../../src/ai/modelClient.js';

class FakeAbortController {
  signal: AbortSignal;
  abort = vi.fn();

  constructor() {
    this.signal = {} as AbortSignal;
  }
}

describe('modelClient', () => {
  const createFetchMock = (status: number, payload: unknown) =>
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(payload),
    }));

  const config: ModelClientConfig = {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'sk-test',
    model: 'gpt-preview',
    timeoutMs: 5000,
  };

  const deps = {
    fetch: vi.fn(),
    AbortController: FakeAbortController as unknown as typeof AbortController,
    now: () => Date.now(),
  };

  const buildParams = (overrides: Partial<GenerateScriptParams> = {}): GenerateScriptParams => ({
    prompt: 'Transform the element into a button.',
    context: {
      selector: {
        id: 'sel-1',
        selector: '#target',
        previewText: 'Target element',
      },
      page: {
        url: 'https://example.test/page',
        title: 'Example page',
      },
      history: ['Attempt 1: Added click handler'],
    },
    responseFormat: 'json',
    ...overrides,
  });

  it('issues chat completion request and parses JSON payload into script result', async () => {
    const fetchMock = createFetchMock(200, {
      choices: [
        {
          message: {
            content: '{"jsCode":"console.log(1);","cssCode":".foo{}"}',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 80,
        total_tokens: 200,
      },
    });

    const client = createModelClient(config, { ...deps, fetch: fetchMock as unknown as typeof fetch });

    const result = await client.generateScript(buildParams());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/chat/completions');
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      Authorization: 'Bearer sk-test',
    });

    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('gpt-preview');
    expect(body.messages[0].content).toBe(DEFAULT_MODEL_SYSTEM_PROMPT);
    expect(body.messages[1].content).toContain('#target');
    expect(body.response_format).toEqual({ type: 'json_object' });

    expect(result.script).toEqual({ jsCode: 'console.log(1);', cssCode: '.foo{}' });
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 80,
      total_tokens: 200,
    });
  });

  it('falls back to treating raw content as jsCode when parsing fails', async () => {
    const fetchMock = createFetchMock(200, {
      choices: [
        {
          message: {
            content: 'console.log("raw");',
          },
        },
      ],
    });

    const client = createModelClient({ ...config, apiKey: null }, { ...deps, fetch: fetchMock as unknown as typeof fetch });
    const result = await client.generateScript(buildParams({ prompt: 'Console log something.' }));

    expect(result.script).toEqual({ jsCode: 'console.log("raw");' });
    const [, init] = (fetchMock as unknown as Mock).mock.calls[0] as [string, RequestInit];
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it('supports array-based content payloads from OpenRouter style responses', async () => {
    const fetchMock = createFetchMock(200, {
      choices: [
        {
          message: {
            content: [
              {
                type: 'text',
                text: '{"jsCode":"console.log(42);"}',
              },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    });

    const client = createModelClient(config, { ...deps, fetch: fetchMock as unknown as typeof fetch });
    const result = await client.generateScript(buildParams());

    expect(result.script).toEqual({ jsCode: 'console.log(42);' });
  });

  it('throws ModelClientError with API response details on failure', async () => {
    const fetchMock = createFetchMock(429, {
      error: { message: 'Rate limit exceeded' },
    });

    const client = createModelClient(config, { ...deps, fetch: fetchMock as unknown as typeof fetch });

    await expect(client.generateScript(buildParams())).rejects.toMatchObject({
      name: 'ModelClientError',
      message: 'Rate limit exceeded',
      status: 429,
    });
  });

  it('propagates abort signals passed through generateScript params', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      return new Promise<Response>((resolve, reject) => {
        const handleAbort = () => {
          init?.signal?.removeEventListener('abort', handleAbort);
          reject(new DOMException('Aborted', 'AbortError'));
        };

        init?.signal?.addEventListener('abort', handleAbort);

        setTimeout(() => {
          init?.signal?.removeEventListener('abort', handleAbort);
          resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () => JSON.stringify({
              choices: [
                {
                  message: {
                    content: '{"jsCode":"console.log(1);"}',
                  },
                },
              ],
            }),
          } as unknown as Response);
        }, 5);
      });
    });

    const client = createModelClient(config, {
      ...deps,
      AbortController,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const externalController = new AbortController();
    const promise = client.generateScript({
      ...buildParams(),
      abortSignal: externalController.signal,
    });

    externalController.abort();

    await expect(promise).rejects.toMatchObject({
      name: 'ModelClientError',
      message: 'Model request timed out.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
