import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageRouter, sendRuntimeMessage } from '../../src/core/messaging.ts';

const sendMessageMock = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: sendMessageMock,
    },
  },
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

describe('sendRuntimeMessage', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    loggerMock.error.mockReset();
  });

  it('forwards runtime messages and returns the response payload', async () => {
    const response = { ok: true, payload: { result: 42 } } as const;
    sendMessageMock.mockResolvedValueOnce(response);

    const result = await sendRuntimeMessage({ type: 'test/message', payload: { value: 1 } });

    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'test/message', payload: { value: 1 } });
    expect(result).toEqual(response);
  });

  it('returns an error response when runtime messaging fails', async () => {
    sendMessageMock.mockRejectedValueOnce(new Error('connection lost'));

    const result = await sendRuntimeMessage({
      type: 'failing/message',
      payload: { value: 2 },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection lost');
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to send runtime message.', expect.objectContaining({ type: 'failing/message' }));
  });
});

describe('createMessageRouter', () => {
  beforeEach(() => {
    loggerMock.error.mockReset();
  });

  it('invokes the handler when message type matches', async () => {
    const handler = vi.fn().mockResolvedValue({ acknowledged: true });
    const router = createMessageRouter('selector/capture', handler);

    const response = await router(
      { type: 'selector/capture', payload: { tabId: 7 } } as any,
      { tab: { id: 7 } } as any,
    );

    expect(handler).toHaveBeenCalledWith({ tabId: 7 }, { tab: { id: 7 } });
    expect(response).toEqual({ ok: true, payload: { acknowledged: true } });
  });

  it('signals an error when message type does not match', async () => {
    const handler = vi.fn();
    const router = createMessageRouter('selector/capture', handler);

    const response = await router({ type: 'other/message', payload: {} } as any, {} as any);

    expect(handler).not.toHaveBeenCalled();
    expect(response.ok).toBe(false);
    expect(response.error).toContain('Unhandled message type');
  });

  it('captures handler failures and surfaces error response', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const router = createMessageRouter('selector/capture', handler);

    const response = await router({ type: 'selector/capture', payload: {} } as any, {} as any);

    expect(response.ok).toBe(false);
    expect(response.error).toBe('boom');
    expect(loggerMock.error).toHaveBeenCalledWith('Runtime message handler failed.', expect.objectContaining({ type: 'selector/capture' }));
  });
});
