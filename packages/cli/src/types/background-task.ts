/**
 * Background Task Types
 *
 * Defines types for long-running AI requests that use OpenAI's background mode API.
 * Background mode allows requests to run for extended periods (>5 minutes) by polling
 * for completion rather than maintaining an open connection.
 */

export interface BackgroundTaskOptions {
  modelKey: string;
  messages: Array<{ role: string; content: string }>;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  textVerbosity?: 'low' | 'medium' | 'high';
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
  webSearch?: boolean;
  serviceTier?: string;
  disableProgress?: boolean;
}

export interface BackgroundTaskStatus {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress?: number; // 0-100
  message?: string;
  error?: string;
}

export interface BackgroundTaskResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
  };
  finishReason: string;
  duration: number; // milliseconds
  responseId: string;
}
