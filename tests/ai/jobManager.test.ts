import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobManager } from '../../src/ai/jobManager.js';

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort);
  });

describe('JobManager', () => {
  const manager = new JobManager<string>();

  afterEach(() => {
    manager.cancelAll();
  });

  it('resolves job results when tasks succeed', async () => {
    const result = await manager.run('tab-1', async (signal) => {
      await wait(1, signal);
      return 'done';
    });

    expect(result.status).toBe('success');
    expect(result.value).toBe('done');
  });

  it('marks job as cancelled when aborted', async () => {
    const resultPromise = manager.run('tab-2', async (signal) => {
      await wait(50, signal);
      return 'never';
    });

    manager.cancel('tab-2');

    const result = await resultPromise;
    expect(result.status).toBe('cancelled');
  });

  it('cancels previous job when new one starts for same key', async () => {
    const first = manager.run('tab-3', async (signal) => {
      await wait(20, signal);
      return 'first';
    });

    const second = manager.run('tab-3', async (signal) => {
      await wait(1, signal);
      return 'second';
    });

    const firstResult = await first;
    const secondResult = await second;

    expect(firstResult.status).toBe('cancelled');
    expect(secondResult.status).toBe('success');
    expect(secondResult.value).toBe('second');
  });

  it('returns error status when task throws', async () => {
    const error = new Error('boom');
    const result = await manager.run('tab-4', async () => {
      throw error;
    });

    expect(result.status).toBe('error');
    expect(result.error).toBe(error);
  });
});
