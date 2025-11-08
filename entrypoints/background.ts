import browser from 'webextension-polyfill';

import { logger } from '../src/core/logger';
import { createModelClient, ModelClientError } from '../src/ai/modelClient';
import { buildGenerationParams } from '../src/ai/promptBuilder';
import { JobManager } from '../src/ai/jobManager';
import { validateGeneratedScript } from '../src/ai/scriptValidator';
import { listTemporaryScripts, removeTemporaryScript, saveTemporaryScript } from '../src/storage/tempScriptStore';
import { loadAiProviderConfig } from '../src/storage/settingsStore';
import { runtimeEnv } from '../src/shared/env';
import { RuntimeMessageType } from '../src/shared/messages';
import type {
  CapturedSelectorState,
  RuntimeMessage,
  RuntimeResponse,
  AiChatMessage,
  AiGenerationTelemetry,
  TemporaryScript,
} from '../src/shared/types';
import type {
  AiCancelRequestPayload,
  AiGenerateRequestPayload,
  AiGenerateResponsePayload,
  SelectorCaptureCommand,
  SelectorGetActivePayload,
  SelectorPreviewState,
  TempScriptCreatePayload,
  TempScriptExecutionPayload,
  TempScriptListPayload,
  TempScriptRemovalPayload,
} from '../src/shared/messages';

const log = logger.child('background');

const capturedSelectors = new Map<number, CapturedSelectorState>();
const capturingTabs = new Set<number>();
const aiJobManager = new JobManager<{ response: AiGenerateResponsePayload; telemetry: AiGenerationTelemetry }>();

const createRequestId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const buildAssistantMessage = (overrides: Partial<AiChatMessage>): AiChatMessage => ({
  id: createRequestId(),
  role: 'assistant',
  content: overrides.content ?? '',
  createdAt: Date.now(),
  script: overrides.script,
  usage: overrides.usage,
  rawText: overrides.rawText,
  finishReason: overrides.finishReason,
  error: overrides.error,
  warnings: overrides.warnings,
});

const resolveTabId = (payloadTabId: number | undefined, senderTabId: number | undefined) => {
  if (typeof payloadTabId === 'number') {
    return payloadTabId;
  }
  if (typeof senderTabId === 'number') {
    return senderTabId;
  }
  throw new Error('Unable to resolve tab id for request.');
};

const broadcastSelectorState = async (tabId: number) => {
  const state: SelectorPreviewState = {
    tabId,
    state: capturedSelectors.get(tabId),
    isCapturing: capturingTabs.has(tabId),
  };

  try {
    await browser.runtime.sendMessage({
      type: RuntimeMessageType.SelectorPreviewUpdated,
      payload: state,
    });
  } catch (error) {
    log.debug('No listeners for selector state broadcast.', {
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const forwardToTab = async (tabId: number, message: RuntimeMessage<RuntimeMessageType, unknown>) => {
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as RuntimeResponse<unknown>;
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Failed to communicate with content script.',
    );
  }
};

const buildTemporaryScript = async (
  payload: TempScriptCreatePayload,
  tabId: number,
): Promise<TemporaryScript> => {
  const now = Date.now();
  const capturedContext = capturedSelectors.get(tabId)?.context;
  const context = {
    url: capturedContext?.url ?? '',
    title: capturedContext?.title,
    surroundingHtml: capturedContext?.surroundingHtml,
  };

  if (!context.url) {
    try {
      const tab = await browser.tabs.get(tabId);
      context.url = tab.url ?? '';
      context.title = tab.title ?? context.title;
    } catch (error) {
      log.warn('Unable to hydrate context from tab.', {
        tabId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `temp-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    selector: payload.selector,
    context,
    script: {
      jsCode: payload.jsCode,
      cssCode: payload.cssCode,
    },
    status: 'pending',
    notes: payload.notes,
  };
};

const handleSelectorCaptureStart = async (
  payload: SelectorCaptureCommand,
  senderTabId: number | undefined,
) => {
  const tabId = resolveTabId(payload.tabId, senderTabId);
  capturingTabs.add(tabId);
  try {
    const response = await forwardToTab(tabId, {
      type: RuntimeMessageType.SelectorCaptureStart,
      payload,
    });

    await broadcastSelectorState(tabId);
    return response;
  } catch (error) {
    capturingTabs.delete(tabId);
    await broadcastSelectorState(tabId);
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: reason,
    } satisfies RuntimeResponse<unknown>;
  }
};

const handleSelectorCaptureStop = async (
  payload: SelectorCaptureCommand,
  senderTabId: number | undefined,
) => {
  const tabId = resolveTabId(payload.tabId, senderTabId);
  capturingTabs.delete(tabId);

  try {
    const response = await forwardToTab(tabId, {
      type: RuntimeMessageType.SelectorCaptureStop,
      payload,
    });

    await broadcastSelectorState(tabId);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await broadcastSelectorState(tabId);
    return {
      ok: false,
      error: reason,
    } satisfies RuntimeResponse<unknown>;
  }
};

const handleSelectorCaptured = async (
  payload: CapturedSelectorState,
  senderTabId: number | undefined,
) => {
  const tabId = resolveTabId(undefined, senderTabId);
  capturedSelectors.set(tabId, payload);
  capturingTabs.delete(tabId);
  await broadcastSelectorState(tabId);
  return { ok: true } satisfies RuntimeResponse<unknown>;
};

const handleSelectorGetActive = async (
  payload: SelectorGetActivePayload,
) => {
  const state = capturedSelectors.get(payload.tabId);
  return {
    ok: true,
    payload: {
      state,
      isCapturing: capturingTabs.has(payload.tabId),
    },
  } satisfies RuntimeResponse<{ state?: CapturedSelectorState; isCapturing: boolean }>;
};

const handleTempScriptCreate = async (
  payload: TempScriptCreatePayload,
  senderTabId: number | undefined,
) => {
  const tabId = resolveTabId(payload.tabId, senderTabId);
  const script = await buildTemporaryScript(payload, tabId);

  await saveTemporaryScript(script);

  try {
    const response = await forwardToTab(tabId, {
      type: RuntimeMessageType.TempScriptExecute,
      payload: { script } satisfies TempScriptExecutionPayload,
    });

    if (!response.ok) {
      throw new Error(response.error ?? 'Preview injection failed.');
    }

    script.status = 'applied';
    script.updatedAt = Date.now();
    await saveTemporaryScript(script);

    return {
      ok: true,
      payload: script,
    } satisfies RuntimeResponse<TemporaryScript>;
  } catch (error) {
    script.status = 'failed';
    script.updatedAt = Date.now();
    script.errorMessage = error instanceof Error ? error.message : String(error);
    await saveTemporaryScript(script);

    log.warn('Temporary script injection failed.', {
      tabId,
      error: script.errorMessage,
    });

    return {
      ok: false,
      error: script.errorMessage,
    } satisfies RuntimeResponse<TemporaryScript>;
  }
};

const handleTempScriptList = async (
  payload: TempScriptListPayload,
  senderTabId: number | undefined,
) => {
  const tabId = resolveTabId(payload.tabId, senderTabId);
  let tabUrl = '';
  try {
    const tab = await browser.tabs.get(tabId);
    tabUrl = tab.url ?? '';
  } catch (error) {
    log.debug('Unable to read tab url for script listing.', {
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let origin = '';
  try {
    if (tabUrl) {
      origin = new URL(tabUrl).origin;
    }
  } catch (error) {
    log.debug('Tab url origin parsing failed for script listing.', {
      tabUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const scripts = await listTemporaryScripts();

  const filtered = scripts
    .filter((script) => {
      if (!script.context?.url) {
        return false;
      }

      if (origin) {
        try {
          return new URL(script.context.url).origin === origin;
        } catch (error) {
          log.debug('Script url origin parsing failed.', {
            scriptId: script.id,
            scriptUrl: script.context.url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return tabUrl ? script.context.url === tabUrl : false;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    ok: true,
    payload: { scripts: filtered },
  } satisfies RuntimeResponse<{ scripts: TemporaryScript[] }>;
};

const handleTempScriptRemove = async (
  payload: TempScriptRemovalPayload,
  senderTabId: number | undefined,
) => {
  const tabId = resolveTabId(payload.tabId, senderTabId);

  try {
    await forwardToTab(tabId, {
      type: RuntimeMessageType.TempScriptRevoke,
      payload: { scriptId: payload.scriptId },
    });
  } catch (error) {
    log.warn('Failed to revoke temp script on content script.', {
      tabId,
      scriptId: payload.scriptId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await removeTemporaryScript(payload.scriptId);

  return {
    ok: true,
  } satisfies RuntimeResponse<unknown>;
};

const handleAiGenerate = async (
  payload: AiGenerateRequestPayload,
  senderTabId: number | undefined,
): Promise<RuntimeResponse<AiGenerateResponsePayload>> => {
  const tabId = resolveTabId(payload.tabId, senderTabId);
  const requestId = createRequestId();
  const selectorState = capturedSelectors.get(tabId);

  if (!selectorState) {
    const message = buildAssistantMessage({
      content: 'Capture an element to provide context before requesting AI assistance.',
      error: 'No selector captured.',
    });
    return {
      ok: false,
      error: 'No selector captured.',
      payload: { requestId, message },
    } satisfies RuntimeResponse<AiGenerateResponsePayload>;
  }

  let aiConfig;
  try {
    aiConfig = await loadAiProviderConfig();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.error('Failed to load AI provider configuration.', {
      tabId,
      error: reason,
    });
    const message = buildAssistantMessage({
      content: 'Unable to read AI provider configuration. Try re-saving settings.',
      error: reason,
    });
    return {
      ok: false,
      error: 'Unable to load AI provider configuration.',
      payload: { requestId, message },
    } satisfies RuntimeResponse<AiGenerateResponsePayload>;
  }

  if (!aiConfig.baseUrl?.trim()) {
    const message = buildAssistantMessage({
      content: 'Configure the AI provider base URL and API key in settings to use PagePilot AI.',
      error: 'AI provider not configured.',
    });
    return {
      ok: false,
      error: 'AI provider not configured.',
      payload: { requestId, message },
    } satisfies RuntimeResponse<AiGenerateResponsePayload>;
  }

  const jobKey = `tab-${tabId}`;

  const jobResult = await aiJobManager.run(jobKey, async (signal) => {
    const startedAt = Date.now();
    const client = createModelClient({
      baseUrl: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
      timeoutMs: 30000,
    });

    const generationParams = buildGenerationParams({
      userPrompt: payload.prompt,
      selector: selectorState.descriptor,
      page: selectorState.context,
      conversation: payload.conversation,
    });

    try {
      const generation = await client.generateScript({
        ...generationParams,
        abortSignal: signal,
      });

      const validation = validateGeneratedScript(generation.script);
      const message = buildAssistantMessage({
        content: generation.rawText,
        script: validation.script ?? generation.script,
        usage: generation.usage,
        rawText: generation.rawText,
        finishReason: generation.finishReason,
        warnings: validation.warnings,
      });

      const telemetry: AiGenerationTelemetry = {
        latencyMs: Date.now() - startedAt,
        usage: generation.usage,
        status: validation.ok ? 'success' : 'error',
        error: validation.ok ? undefined : validation.errors.join(' '),
      };

      if (!validation.ok) {
        message.error = validation.errors.join(' ');
        throw Object.assign(new Error(message.error), {
          response: { requestId, message },
          telemetry,
        });
      }

      return {
        response: { requestId, message },
        telemetry,
      };
    } catch (error) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const reason = error instanceof Error ? error.message : 'AI generation failed.';
      const message = buildAssistantMessage({
        content: reason,
        error: reason,
      });

      if (error instanceof ModelClientError && error.details) {
        try {
          message.rawText = JSON.stringify(error.details);
        } catch {
          message.rawText = String(error.details);
        }
      }

      const telemetry: AiGenerationTelemetry = {
        latencyMs: Date.now() - startedAt,
        status: 'error',
        error: reason,
      };

      throw Object.assign(error instanceof Error ? error : new Error(reason), {
        response: { requestId, message },
        telemetry,
      });
    }
  });

  if (jobResult.status === 'success') {
    if (!jobResult.value) {
      const fallback = buildAssistantMessage({
        content: 'AI generation completed without a response payload.',
        error: 'Missing AI response.',
      });
      return {
        ok: false,
        error: 'AI generation produced no response.',
        payload: { requestId, message: fallback },
      } satisfies RuntimeResponse<AiGenerateResponsePayload>;
    }

    const { response, telemetry } = jobResult.value;
    log.info('AI generation completed.', {
      tabId,
      requestId: response.requestId,
      latencyMs: telemetry.latencyMs,
      usage: telemetry.usage,
    });
    return {
      ok: true,
      payload: response,
    } satisfies RuntimeResponse<AiGenerateResponsePayload>;
  }

  if (jobResult.status === 'cancelled') {
    const message = buildAssistantMessage({
      content: 'Request cancelled.',
      error: 'Request cancelled.',
    });
    log.debug('AI generation cancelled.', {
      tabId,
      requestId,
    });
    return {
      ok: false,
      error: 'Request cancelled.',
      payload: { requestId, message },
    } satisfies RuntimeResponse<AiGenerateResponsePayload>;
  }

  const error = jobResult.error as (Error & {
    response?: AiGenerateResponsePayload;
    telemetry?: AiGenerationTelemetry;
  });

  const response = error.response ?? {
    requestId,
    message: buildAssistantMessage({
      content: error.message ?? 'AI generation failed.',
      error: error.message ?? 'AI generation failed.',
    }),
  };

  const telemetry = error.telemetry ?? {
    latencyMs: 0,
    status: 'error',
    error: error.message ?? 'AI generation failed.',
  } satisfies AiGenerationTelemetry;

  log.warn('AI generation failed.', {
    tabId,
    requestId: response.requestId,
    error: error.message ?? 'Unknown error',
    telemetry,
  });

  return {
    ok: false,
    error: error.message ?? 'AI generation failed.',
    payload: response,
  } satisfies RuntimeResponse<AiGenerateResponsePayload>;
};

const handleAiCancel = (
  payload: AiCancelRequestPayload,
  senderTabId: number | undefined,
): RuntimeResponse<{ cancelled: boolean }> => {
  const tabId = resolveTabId(payload.tabId, senderTabId);
  const jobKey = `tab-${tabId}`;
  aiJobManager.cancel(jobKey);
  return {
    ok: true,
    payload: { cancelled: true },
  } satisfies RuntimeResponse<{ cancelled: boolean }>;
};

const handlePing = (payload: unknown) => {
  log.debug('Received ping.', { payload });
  return {
    ok: true,
    payload: { timestamp: Date.now() },
  } satisfies RuntimeResponse<{ timestamp: number }>;
};

const handleRuntimeMessage = (
  message: RuntimeMessage<RuntimeMessageType, unknown>,
  sender: browser.Runtime.MessageSender,
): Promise<RuntimeResponse<unknown>> | undefined => {
  switch (message.type) {
    case RuntimeMessageType.Ping:
      return Promise.resolve(handlePing(message.payload));
    case RuntimeMessageType.SelectorCaptureStart:
      return handleSelectorCaptureStart(message.payload as SelectorCaptureCommand, sender.tab?.id);
    case RuntimeMessageType.SelectorCaptureStop:
      return handleSelectorCaptureStop(message.payload as SelectorCaptureCommand, sender.tab?.id);
    case RuntimeMessageType.SelectorCaptured:
      return handleSelectorCaptured(message.payload as CapturedSelectorState, sender.tab?.id);
    case RuntimeMessageType.SelectorGetActive:
      return handleSelectorGetActive(message.payload as SelectorGetActivePayload);
    case RuntimeMessageType.TempScriptCreate:
      return handleTempScriptCreate(message.payload as TempScriptCreatePayload, sender.tab?.id);
    case RuntimeMessageType.TempScriptList:
      return handleTempScriptList(message.payload as TempScriptListPayload, sender.tab?.id);
    case RuntimeMessageType.TempScriptRemove:
      return handleTempScriptRemove(message.payload as TempScriptRemovalPayload, sender.tab?.id);
    case RuntimeMessageType.AiGenerate:
      return handleAiGenerate(message.payload as AiGenerateRequestPayload, sender.tab?.id);
    case RuntimeMessageType.AiCancel:
      return Promise.resolve(handleAiCancel(message.payload as AiCancelRequestPayload, sender.tab?.id));
    default:
      return undefined;
  }
};

export default defineBackground(() => {
  log.info('Service worker initialized.', {
    runtimeId: browser.runtime.id,
    mode: runtimeEnv.mode,
    version: runtimeEnv.version,
  });

  browser.runtime.onMessage.addListener((message: unknown, sender: browser.Runtime.MessageSender) => {
    const runtimeMessage = message as RuntimeMessage<RuntimeMessageType, unknown>;
    const result = handleRuntimeMessage(runtimeMessage, sender);
    if (result) {
      return result;
    }
    return undefined;
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    capturedSelectors.delete(tabId);
    capturingTabs.delete(tabId);
  });

  browser.runtime.onSuspend?.addListener(() => {
    capturingTabs.clear();
  });
});
