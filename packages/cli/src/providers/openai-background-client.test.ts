import { describe, expect, it } from 'bun:test';
import { OpenAIBackgroundClient } from './openai-background-client.js';

describe('OpenAIBackgroundClient', () => {
  it('maps statuses correctly', async () => {
    const instance = Object.create(OpenAIBackgroundClient.prototype) as OpenAIBackgroundClient;
    const responses = [
      { status: 'queued', id: 'task-1', error: null },
      { status: 'requires_action', id: 'task-1', error: null },
      { status: 'completed', id: 'task-1', error: null },
    ];
    let call = 0;
    (instance as any).client = {
      responses: {
        retrieve: async () => responses[call++],
        create: async () => ({ id: 'task-1' }),
      },
    };

    const queued = await instance.getTaskStatus('task-1');
    expect(queued.status).toBe('queued');

    const inProgress = await instance.getTaskStatus('task-1');
    expect(inProgress.status).toBe('in_progress');

    const completed = await instance.getTaskStatus('task-1');
    expect(completed.status).toBe('completed');
  });

  it('throws not-ready error for initial 404s', async () => {
    const instance = Object.create(OpenAIBackgroundClient.prototype) as OpenAIBackgroundClient;
    (instance as any).client = {
      responses: {
        retrieve: async () => {
          const error: any = new Error('not found');
          error.status = 404;
          throw error;
        },
      },
    };

    await expect(instance.getTaskStatus('missing-task')).rejects.toThrow('Background task not yet visible');
  });

  it('extracts text and usage from completed response', async () => {
    const instance = Object.create(OpenAIBackgroundClient.prototype) as OpenAIBackgroundClient;
    (instance as any).client = {
      responses: {
        retrieve: async () => ({
          status: 'completed',
          id: 'task-1',
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            total_tokens: 300,
            output_tokens_details: {
              reasoning_tokens: 42,
            },
          },
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: 'Hello' },
                { type: 'output_text', text: 'World' },
              ],
            },
          ],
        }),
      },
    };

    const result = await instance.getTaskResult('task-1');
    expect(result.text).toBe('Hello\nWorld');
    expect(result.usage?.inputTokens).toBe(100);
    expect(result.usage?.outputTokens).toBe(200);
    expect(result.usage?.totalTokens).toBe(300);
    expect(result.finishReason).toBe('stop');
  });
});
