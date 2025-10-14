/**
 * Background Task Handler
 *
 * Orchestrates long-running AI requests by submitting tasks to OpenAI's
 * background mode API, polling for completion, and providing progress updates.
 */

import { OpenAIBackgroundClient } from './openai-background-client.js';
import { ProgressReporter } from '../utils/progress-reporter.js';
import type {
  BackgroundTaskOptions,
  BackgroundTaskResult,
} from '../types/background-task.js';

export class BackgroundTaskHandler {
  private client: OpenAIBackgroundClient;
  private progressReporter: ProgressReporter;
  private pollInterval: number;
  private maxWaitTime: number;
  private readonly maxNotReadyRetries: number;
  private readonly notReadyAttempts = new Map<string, number>();

  constructor(apiKey: string, options?: { pollInterval?: number; maxWaitTime?: number; fetch?: typeof fetch; maxNotReadyRetries?: number; client?: OpenAIBackgroundClient }) {
    const injectedClient = options?.client;
    const injectedFetch = options?.fetch;
    const clientConfig = injectedFetch ? { fetch: injectedFetch } : undefined;
    this.client = injectedClient ?? new OpenAIBackgroundClient(apiKey, clientConfig);
    this.progressReporter = new ProgressReporter();

    // Configure polling behavior
    this.pollInterval = options?.pollInterval ||
      parseInt(process.env.PROMPTCODE_BACKGROUND_POLL_INTERVAL || '5000', 10);

    this.maxWaitTime = options?.maxWaitTime ||
      parseInt(process.env.PROMPTCODE_BACKGROUND_MAX_WAIT || '7200000', 10); // 120 minutes default
    this.maxNotReadyRetries = options?.maxNotReadyRetries ?? 3;
  }

  /**
   * Execute a background task with polling and progress updates.
   *
   * @param options - Task configuration passed through to the OpenAI background client.
   * @param runOptions - Execution controls (e.g. override for maximum wait time in milliseconds).
   */
  async execute(
    options: BackgroundTaskOptions,
    runOptions: { maxWaitTimeMs?: number } = {}
  ): Promise<BackgroundTaskResult> {
    this.progressReporter = new ProgressReporter({ silent: options.disableProgress === true });

    // 1. Submit task
    this.progressReporter.start('Submitting request to OpenAI background mode...');

    let taskId: string;
    try {
      taskId = await this.client.submitTask(options);
    } catch (error: unknown) {
      this.progressReporter.error('Failed to submit task');
      const message = this.toErrorMessage(error);
      throw new Error(`Failed to submit background task: ${message}`);
    }

    this.progressReporter.update(
      `Task submitted! ID: ${taskId.substring(0, 12)}...\n` +
      `Polling for results (this may take 1-60 minutes for long requests)...`
    );

    // 2. Poll for completion
    const startTime = Date.now();
    let lastStatus: string | null = null;
    const maxWaitTime = runOptions.maxWaitTimeMs ?? this.maxWaitTime;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const status = await this.retryWithBackoff(
          () => this.client.getTaskStatus(taskId),
          3,
          1000
        );

        this.notReadyAttempts.delete(taskId);

        // Update progress if status changed
        if (status.status !== lastStatus) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          this.progressReporter.update(
            `[${minutes}m ${seconds}s] ${status.message}`
          );
          lastStatus = status.status;
        }

        // Check completion states
        if (status.status === 'completed') {
          this.progressReporter.complete('Task completed! Retrieving results...');
          const result = await this.client.getTaskResult(taskId);
          result.duration = Date.now() - startTime;
          return result;
        }

        if (status.status === 'failed') {
          this.progressReporter.error('Task failed');
          this.notReadyAttempts.delete(taskId);
          throw new Error(`Background task failed: ${status.error || 'Unknown error'}`);
        }

        // Wait before next poll
        await this.sleep(this.getNextPollInterval(Date.now() - startTime));
      } catch (error: unknown) {
        this.logPollingError(taskId, error);
        // If we can't get status, check if it's a transient error
        if (this.isTaskNotReadyError(error, taskId)) {
          const attempts = this.incrementNotReadyAttempts(taskId);
          if (attempts <= this.maxNotReadyRetries) {
            await this.sleep(this.getNotReadyRetryDelay(attempts));
            continue;
          }
          this.notReadyAttempts.delete(taskId);
        }

        if (this.isTransientError(error)) {
          // Just wait and try again with jittered poll interval
          await this.sleep(this.getNextPollInterval(Date.now() - startTime));
          continue;
        }

        // Fatal error
        this.progressReporter.error('Failed to poll task status');
        this.notReadyAttempts.delete(taskId);
        throw error;
      }
    }

    // Timeout
    this.progressReporter.error('Task timed out');
    this.notReadyAttempts.delete(taskId);
    throw new Error(
      `Background task timed out after ${maxWaitTime / 1000}s. ` +
      `Task ID: ${taskId} - You can check the status manually later.`
    );
  }

  /**
   * Retry a function with exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error;
        const isRetryable = this.isTransientError(error);
        const isLastAttempt = i === maxRetries - 1;

        if (!isRetryable || isLastAttempt) {
          throw error;
        }

        const delay = this.addJitter(baseDelay * Math.pow(2, i));
        this.progressReporter.update(
          `Error occurred. Retrying in ${delay / 1000}s... (${i + 1}/${maxRetries})`
        );
        await this.sleep(delay);
      }
    }
    const fallbackMessage = 'Max retries exceeded while executing background operation';
    if (lastError instanceof Error) {
      throw new Error(`${fallbackMessage}: ${lastError.message}`, { cause: lastError });
    }
    throw new Error(fallbackMessage, { cause: lastError as Error | undefined });
  }

  /**
   * Determine whether an error is transient and can be retried safely.
   */
  private isTransientError(error: unknown): boolean {
    // Network errors
    const code = this.getErrorCode(error);
    const transientCodes = new Set([
      'ETIMEDOUT',
      'ECONNRESET',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'ECONNREFUSED',
    ]);
    if (code && transientCodes.has(code)) {
      return true;
    }

    // HTTP 5xx errors (server errors)
    const status = this.getErrorStatus(error);
    if (typeof status === 'number' && status >= 500 && status < 600) {
      return true;
    }

    // Rate limiting
    if (status === 429) {
      return true;
    }

    const message = this.toErrorMessage(error).toLowerCase();
    if (message.includes('socket') && message.includes('closed')) {
      return true;
    }

    return false;
  }

  /**
   * Identify if an error indicates the background task is not yet ready.
   */
  private isTaskNotReadyError(error: unknown, taskId?: string): boolean {
    if (!taskId) {return false;}
    const code = this.getErrorCode(error);
    if (code === 'BACKGROUND_TASK_NOT_READY') {return true;}
    const record = this.asRecord(error);
    if (record?.name === 'OpenAIBackgroundTaskNotReady') {return true;}
    const status = this.getErrorStatus(error);
    if (status === 404 && record?.temporary === true) {return true;}
    return false;
  }

  /**
   * Increment retry counter for "not ready" responses and return the new value.
   */
  private incrementNotReadyAttempts(taskId: string): number {
    const current = this.notReadyAttempts.get(taskId) ?? 0;
    const next = current + 1;
    this.notReadyAttempts.set(taskId, next);
    return next;
  }

  /**
   * Exponential backoff for background task readiness polling with jitter.
   */
  private getNotReadyRetryDelay(attempt: number): number {
    const base = 500;
    return this.addJitter(base * Math.pow(2, Math.max(0, attempt - 1)));
  }

  /**
   * Compute next poll interval based on elapsed time and configured backoff.
   */
  private getNextPollInterval(elapsedMs: number): number {
    const base = this.pollInterval;
    const step = Math.floor(elapsedMs / 60000);
    const target = Math.min(base + step * 1000, 30000);
    return this.addJitter(target);
  }

  /**
   * Add bounded random jitter to a delay to avoid thundering herd behaviour.
   */
  private addJitter(delay: number): number {
    const jitterRange = Math.max(250, Math.floor(delay * 0.1));
    const halfRange = Math.floor(jitterRange / 2);
    const jitter = Math.floor(Math.random() * jitterRange) - halfRange;
    return Math.max(500, delay + jitter);
  }

  /**
   * Emit detailed debug logs for polling failures when background debugging is enabled.
   */
  private logPollingError(taskId: string, error: unknown): void {
    if (!process.env.DEBUG && process.env.PROMPTCODE_DEBUG_BACKGROUND !== '1') {
      return;
    }
    const message = this.toErrorMessage(error);
    const code = this.getErrorCode(error);
    const status = this.getErrorStatus(error);
    const parts = [`message=${message}`];
    if (code) {parts.push(`code=${code}`);}
    if (typeof status === 'number') {parts.push(`status=${status}`);}
    console.error(`[DEBUG background] Poll error for task ${taskId}: ${parts.join(' ')}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack.split('\n').slice(0, 5).join('\n'));
    }
  }

  /**
   * Normalize unknown error shapes into a safe log-friendly message string.
   */
  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message || error.name;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  /**
   * Extract a string error code from an unknown error payload.
   */
  private getErrorCode(error: unknown): string | undefined {
    const record = this.asRecord(error);
    const code = record?.code;
    if (typeof code === 'string') {
      return code;
    }
    const cause = this.asRecord(record?.cause);
    if (typeof cause?.code === 'string') {
      return cause.code;
    }
    return undefined;
  }

  /**
   * Extract an HTTP status (if present) from an unknown error payload.
   */
  private getErrorStatus(error: unknown): number | undefined {
    const record = this.asRecord(error);
    const status = record?.status;
    if (typeof status === 'number') {
      return status;
    }
    const cause = this.asRecord(record?.cause);
    const causeStatus = cause?.status;
    if (typeof causeStatus === 'number') {
      return causeStatus;
    }
    return undefined;
  }

  /**
   * Safely coerce values into a generic record for property inspection.
   */
  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (value && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
    return undefined;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
