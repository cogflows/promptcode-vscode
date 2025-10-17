import { describe, expect, it } from 'bun:test';
import { BackgroundTaskHandler } from './background-task-handler.js';
import type { BackgroundTaskOptions, BackgroundTaskResult, BackgroundTaskStatus } from '../types/background-task.js';
import type { OpenAIBackgroundClient } from './openai-background-client.js';

type MockStatus = BackgroundTaskStatus | Error;

function createMockClient(queue: MockStatus[], result: BackgroundTaskResult): OpenAIBackgroundClient {
  let statusQueue = queue.slice();
  return {
    submitTask: async (_options: BackgroundTaskOptions) => 'task-123',
    getTaskStatus: async () => {
      if (!statusQueue.length) {
        throw new Error('Status queue empty');
      }
      const next = statusQueue.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    getTaskResult: async () => result,
  } as unknown as OpenAIBackgroundClient;
}

describe('BackgroundTaskHandler', () => {
  it('retries temporary 404 responses before succeeding', async () => {
    const notReadyError: any = new Error('not ready');
    notReadyError.code = 'BACKGROUND_TASK_NOT_READY';
    notReadyError.status = 404;
    notReadyError.temporary = true;

    const client = createMockClient(
      [
        notReadyError,
        { id: 'task-123', status: 'queued', message: 'queued', error: undefined },
        { id: 'task-123', status: 'completed', message: 'done', error: undefined },
      ],
      {
        text: 'ok',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
        finishReason: 'stop',
        duration: 0,
        responseId: 'response-1',
      }
    );

    const handler = new BackgroundTaskHandler('fake-key', {
      client,
      pollInterval: 100,
      maxNotReadyRetries: 5,
    });

    const result = await handler.execute({
      modelKey: 'gpt-5-pro',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.text).toBe('ok');
  });

  it('treats extended network errors as transient', () => {
    const handler = new BackgroundTaskHandler('fake-key', {
      client: createMockClient([], {
        text: '',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        finishReason: 'stop',
        duration: 0,
        responseId: 'x',
      }),
      pollInterval: 100,
    });

    const transientCodes = [
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'ECONNREFUSED',
    ];

    for (const code of transientCodes) {
      const error = { code };
      expect((handler as any).isTransientError(error)).toBe(true);
    }
  });

  it('applies jitter to poll intervals', () => {
    const handler = new BackgroundTaskHandler('fake-key', {
      client: createMockClient([], {
        text: '',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        finishReason: 'stop',
        duration: 0,
        responseId: 'x',
      }),
      pollInterval: 1000,
    });

    const interval = (handler as any).getNextPollInterval(5 * 60 * 1000);
    expect(interval).toBeGreaterThanOrEqual(500);
    expect(interval).toBeLessThanOrEqual(30000);
  });
});
