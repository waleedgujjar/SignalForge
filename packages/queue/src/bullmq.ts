import { Queue, Worker, type ConnectionOptions, type JobsOptions, type Processor, type WorkerOptions } from 'bullmq';

export type { Queue } from 'bullmq';

export function createQueue<TData = unknown>(
  name: string,
  connection: ConnectionOptions,
): Queue<TData> {
  return new Queue<TData>(name, { connection });
}

export type CreateWorkerOpts = Partial<Pick<WorkerOptions, 'concurrency' | 'lockDuration' | 'stalledInterval' | 'maxStalledCount'>>;

export function createWorker<TData = unknown, TResult = unknown>(
  name: string,
  processor: Processor<TData, TResult>,
  connection: ConnectionOptions,
  opts?: CreateWorkerOpts,
): Worker<TData, TResult> {
  return new Worker<TData, TResult>(name, processor, {
    connection,
    concurrency: opts?.concurrency ?? 5,
    lockDuration: opts?.lockDuration ?? 30_000,
    stalledInterval: opts?.stalledInterval ?? 30_000,
    maxStalledCount: opts?.maxStalledCount ?? 2,
  });
}

export function withJobTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Job timed out after ${timeoutMs}ms`)), timeoutMs);
    fn().then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export const ENRICHMENT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 15_000,
  },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export const WEBSITE_ANALYSIS_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 30_000,
  },
  removeOnComplete: 100,
  removeOnFail: 500,
};
