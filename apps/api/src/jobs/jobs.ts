import { Logger } from '@nestjs/common';

export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

/**
 * Background work (CLAUDE.md rule 4): reminders, emails, and later OCR, imports and report generation.
 * Handlers are registered by name; work is either queued once (`enqueue`) or repeated (`every`).
 */
export abstract class Jobs {
  protected readonly handlers = new Map<string, JobHandler>();
  protected readonly logger = new Logger('Jobs');

  register(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  /**
   * Runs `name` once, soon, outside the current request. Retried on failure where the runner supports it.
   * `delayMs` waits first, e.g. for the caller's transaction to commit.
   */
  abstract enqueue(name: string, data?: Record<string, unknown>, delayMs?: number): Promise<void>;

  /** Runs `name` every `ms` milliseconds. Safe to call on every start: one schedule per name. */
  abstract every(name: string, ms: number): Promise<void>;

  abstract close(): Promise<void>;

  protected async run(name: string, data: Record<string, unknown>) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler for job "${name}"`);
    await handler(data);
  }
}

/** Without Redis (local work, tests): jobs run inside the API process. Nothing survives a restart. */
export class InProcessJobs extends Jobs {
  private readonly timers: NodeJS.Timeout[] = [];

  async enqueue(name: string, data: Record<string, unknown> = {}, delayMs = 0) {
    const timer = setTimeout(() => {
      this.run(name, data).catch((error) => this.logger.error(`${name} failed: ${String(error)}`));
    }, delayMs);
    timer.unref();
  }

  async every(name: string, ms: number) {
    const timer = setInterval(() => {
      this.run(name, {}).catch((error) => this.logger.error(`${name} failed: ${String(error)}`));
    }, ms);
    timer.unref();
    this.timers.push(timer);
  }

  async close() {
    for (const timer of this.timers) clearInterval(timer);
  }
}

/**
 * With Redis: BullMQ. Queued work survives restarts, is retried with back-off, and with several API processes each
 * job runs once. Repeating jobs use job schedulers, so starting several processes does not multiply them.
 */
export class BullJobs extends Jobs {
  private queue?: import('bullmq').Queue;
  private worker?: import('bullmq').Worker;

  constructor(private readonly redisUrl: string) {
    super();
  }

  private async start() {
    if (this.queue) return this.queue;
    const { Queue, Worker } = await import('bullmq');
    const connection = { url: this.redisUrl, maxRetriesPerRequest: null };
    this.queue = new Queue('yucampus', { connection });
    this.worker = new Worker('yucampus', (job) => this.run(job.name, (job.data ?? {}) as Record<string, unknown>), {
      connection,
      concurrency: 4,
    });
    this.worker.on('failed', (job, error) => this.logger.error(`${job?.name} failed (attempt ${job?.attemptsMade}): ${error.message}`));
    return this.queue;
  }

  async enqueue(name: string, data: Record<string, unknown> = {}, delayMs = 0) {
    const queue = await this.start();
    await queue.add(name, data, { delay: delayMs, attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 });
  }

  async every(name: string, ms: number) {
    const queue = await this.start();
    await queue.upsertJobScheduler(name, { every: ms }, { name, data: {}, opts: { removeOnComplete: 100, removeOnFail: 500 } });
  }

  async close() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
