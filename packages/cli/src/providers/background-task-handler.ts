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

  constructor(apiKey: string, options?: { pollInterval?: number; maxWaitTime?: number }) {
    this.client = new OpenAIBackgroundClient(apiKey);
    this.progressReporter = new ProgressReporter();

    // Configure polling behavior
    this.pollInterval = options?.pollInterval ||
      parseInt(process.env.PROMPTCODE_BACKGROUND_POLL_INTERVAL || '5000', 10);

    this.maxWaitTime = options?.maxWaitTime ||
      parseInt(process.env.PROMPTCODE_BACKGROUND_MAX_WAIT || '7200000', 10); // 120 minutes default
  }

  /**
   * Execute a background task with polling and progress updates
   */
  async execute(options: BackgroundTaskOptions): Promise<BackgroundTaskResult> {
    this.progressReporter = new ProgressReporter({ silent: options.disableProgress === true });

    // 1. Submit task
    this.progressReporter.start('Submitting request to OpenAI background mode...');

    let taskId: string;
    try {
      taskId = await this.client.submitTask(options);
    } catch (error: any) {
      this.progressReporter.error('Failed to submit task');
      throw new Error(`Failed to submit background task: ${error.message}`);
    }

    this.progressReporter.update(
      `Task submitted! ID: ${taskId.substring(0, 12)}...\n` +
      `Polling for results (this may take 1-60 minutes for long requests)...`
    );

    // 2. Poll for completion
    const startTime = Date.now();
    let lastStatus: string | null = null;

    while (Date.now() - startTime < this.maxWaitTime) {
      try {
        const status = await this.retryWithBackoff(
          () => this.client.getTaskStatus(taskId),
          3,
          1000
        );

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
          throw new Error(`Background task failed: ${status.error || 'Unknown error'}`);
        }

        // Wait before next poll
        await this.sleep(this.pollInterval);
      } catch (error: any) {
        // If we can't get status, check if it's a transient error
        if (this.isTransientError(error)) {
          // Just wait and try again
          await this.sleep(this.pollInterval);
          continue;
        }

        // Fatal error
        this.progressReporter.error('Failed to poll task status');
        throw error;
      }
    }

    // Timeout
    this.progressReporter.error('Task timed out');
    throw new Error(
      `Background task timed out after ${this.maxWaitTime / 1000}s. ` +
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
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        const isRetryable = this.isTransientError(error);
        const isLastAttempt = i === maxRetries - 1;

        if (!isRetryable || isLastAttempt) {
          throw error;
        }

        const delay = baseDelay * Math.pow(2, i);
        this.progressReporter.update(
          `Error occurred. Retrying in ${delay / 1000}s... (${i + 1}/${maxRetries})`
        );
        await this.sleep(delay);
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Check if an error is transient (should retry)
   */
  private isTransientError(error: any): boolean {
    // Network errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
      return true;
    }

    // HTTP 5xx errors (server errors)
    if (error.status && error.status >= 500 && error.status < 600) {
      return true;
    }

    // Rate limiting
    if (error.status === 429) {
      return true;
    }

    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
