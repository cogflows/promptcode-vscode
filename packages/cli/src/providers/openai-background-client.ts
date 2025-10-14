/**
 * OpenAI Background Client
 *
 * Wrapper around the OpenAI SDK for handling background (long-running) requests.
 * Uses OpenAI's background mode API which allows requests to run for extended
 * periods (>5 minutes) by submitting a task and polling for completion.
 */

import OpenAI from 'openai';
import type {
  BackgroundTaskOptions,
  BackgroundTaskStatus,
  BackgroundTaskResult,
} from '../types/background-task.js';

type ReasoningEffort = BackgroundTaskOptions['reasoningEffort'];

export class OpenAIBackgroundClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Submit a background task to OpenAI
   * @returns The task ID to use for polling
   */
  async submitTask(options: BackgroundTaskOptions): Promise<string> {
    const request: Record<string, unknown> = {
      model: options.modelKey,
      background: true,
      store: true,
      input: this.buildInputMessages(options.messages),
      instructions: options.systemPrompt,
    };

    if (typeof options.maxTokens === 'number') {
      request.max_output_tokens = options.maxTokens;
    }
    if (typeof options.temperature === 'number') {
      request.temperature = options.temperature;
    }
    if (options.serviceTier) {
      request.service_tier = options.serviceTier;
    }

    const reasoning = this.toReasoning(options.reasoningEffort);
    if (reasoning) {
      request.reasoning = reasoning;
    }

    const textConfig = this.toTextConfig(options.textVerbosity);
    if (textConfig) {
      request.text = textConfig;
    }

    const response = await this.client.responses.create(request as any);

    if (!response.id) {
      throw new Error('OpenAI did not return a background response id');
    }

    return response.id;
  }

  /**
   * Poll for task status
   * @returns Current status of the task
   */
  async getTaskStatus(taskId: string): Promise<BackgroundTaskStatus> {
    try {
      const response = await this.client.responses.retrieve(taskId);
      const status = this.mapStatus(response.status);

      return {
        id: taskId,
        status,
        message: this.getStatusMessage(status, response.status),
        error: response.error?.message,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return {
          id: taskId,
          status: 'failed',
          error: 'Task not found',
        };
      }
      throw error;
    }
  }

  /**
   * Get completed task result
   * @throws Error if task is not completed
  */
  async getTaskResult(taskId: string): Promise<BackgroundTaskResult> {
    const response = await this.client.responses.retrieve(taskId);

    if (response.status !== 'completed') {
      throw new Error(`Task not completed. Status: ${response.status}`);
    }

    const usage = response.usage;

    return {
      text: this.extractText(response),
      usage: {
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? ((usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)),
        reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? undefined,
      },
      finishReason: this.extractFinishReason(response),
      duration: 0,
      responseId: response.id,
    };
  }

  /**
   * Map OpenAI status to our internal status type
   */
  private mapStatus(openaiStatus?: string | null): BackgroundTaskStatus['status'] {
    switch (openaiStatus) {
      case 'queued':
        return 'queued';
      case 'in_progress':
      case 'incomplete':
      case 'requires_action':
        return 'in_progress';
      case 'completed':
        return 'completed';
      case 'failed':
      case 'cancelled':
        return 'failed';
      default:
        return 'in_progress';
    }
  }

  /**
   * Get user-friendly status message
   */
  private getStatusMessage(
    status: BackgroundTaskStatus['status'],
    rawStatus?: string | null,
  ): string {
    switch (status) {
      case 'queued':
        return 'Task queued, waiting to start...';
      case 'in_progress':
        return rawStatus === 'requires_action'
          ? 'Task is waiting on required action from the model...'
          : 'GPT-5 Pro is thinking deeply about your request...';
      case 'completed':
        return 'Task completed successfully!';
      case 'failed':
        return 'Task failed';
      default:
        return 'Processing...';
    }
  }

  private buildInputMessages(messages: BackgroundTaskOptions['messages']) {
    return messages.map(message => ({
      role: this.normalizeRole(message.role),
      content: message.content,
      type: 'message' as const,
    }));
  }

  private normalizeRole(role: string): 'user' | 'assistant' | 'system' | 'developer' {
    if (role === 'assistant' || role === 'system' || role === 'developer') {
      return role;
    }
    if (role === 'tool' || role === 'function') {
      return 'assistant';
    }
    return 'user';
  }

  private toReasoning(effort: ReasoningEffort | undefined) {
    if (!effort) {
      return undefined;
    }
    return { effort } as const;
  }

  private toTextConfig(verbosity: BackgroundTaskOptions['textVerbosity'] | undefined) {
    if (!verbosity) {
      return undefined;
    }
    return { verbosity } as const;
  }

  private extractFinishReason(response: any): string {
    const outputs: Array<any> | undefined = Array.isArray(response.output) ? response.output : undefined;
    if (outputs) {
      for (const output of outputs) {
        if (output?.finish_reason) {
          return String(output.finish_reason);
        }
        if (output?.status === 'completed') {
          return 'stop';
        }
      }
    }
    return 'stop';
  }

  private extractText(response: any): string {
    if (typeof response?.output_text === 'string') {
      return response.output_text;
    }
    const outputs: Array<any> | undefined = Array.isArray(response?.output) ? response.output : undefined;
    if (!outputs) {
      return '';
    }
    const chunks: string[] = [];
    for (const output of outputs) {
      if (output?.type === 'message' && Array.isArray(output.content)) {
        for (const part of output.content) {
          if (part?.type === 'output_text' && typeof part.text === 'string') {
            chunks.push(part.text);
          }
        }
      }
    }
    return chunks.join('\n');
  }
}
