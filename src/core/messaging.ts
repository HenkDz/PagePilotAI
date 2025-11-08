import browser from 'webextension-polyfill';
import type { Runtime } from 'webextension-polyfill';

import type { RuntimeMessage, RuntimeResponse } from '../shared/types';
import { logger } from './logger';

const log = logger.child('messaging');

export type MessageHandler<TRequest, TResponse> = (
  request: TRequest,
  sender: Runtime.MessageSender,
) => Promise<TResponse> | TResponse;

export const sendRuntimeMessage = async <TType extends string, TPayload, TResult>(
  message: RuntimeMessage<TType, TPayload>,
): Promise<RuntimeResponse<TResult>> => {
  try {
    const response = await browser.runtime.sendMessage(message);
    return response as RuntimeResponse<TResult>;
  } catch (error) {
    log.error('Failed to send runtime message.', { error, type: message.type });
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown message failure',
    };
  }
};

export const createMessageRouter = <TType extends string, TPayload, TResult>(
  type: TType,
  handler: MessageHandler<TPayload, TResult>,
) => async (
  request: RuntimeMessage<TType, TPayload>,
  sender: Runtime.MessageSender,
): Promise<RuntimeResponse<TResult>> => {
  if (request.type !== type) {
    return { ok: false, error: `Unhandled message type: ${request.type}` };
  }

  try {
    const payload = await handler(request.payload, sender);
    return { ok: true, payload };
  } catch (error) {
    log.error('Runtime message handler failed.', { type, error });
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown handler error',
    };
  }
};
