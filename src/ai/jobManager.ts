export interface JobResult<T> {
  status: 'success' | 'error' | 'cancelled';
  value?: T;
  error?: unknown;
}

interface ActiveJob<T> {
  controller: AbortController;
  promise: Promise<JobResult<T>>;
}

export class JobManager<T> {
  private readonly jobs = new Map<string, ActiveJob<T>>();

  async run(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<JobResult<T>> {
    this.cancel(key);

    const controller = new AbortController();

    const wrapped = (async () => {
      try {
        const value = await task(controller.signal);
        return { status: 'success', value } satisfies JobResult<T>;
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          return { status: 'cancelled' } satisfies JobResult<T>;
        }
        return { status: 'error', error } satisfies JobResult<T>;
      } finally {
        const active = this.jobs.get(key);
        if (active?.controller === controller) {
          this.jobs.delete(key);
        }
      }
    })();

    this.jobs.set(key, { controller, promise: wrapped });

    return wrapped;
  }

  cancel(key: string): void {
    const active = this.jobs.get(key);
    if (!active) {
      return;
    }

    active.controller.abort();
    this.jobs.delete(key);
  }

  cancelAll(): void {
    for (const key of this.jobs.keys()) {
      this.cancel(key);
    }
  }
}
