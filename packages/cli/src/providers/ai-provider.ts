/**
 * AI Provider using Vercel AI SDK
 *
 * Now powered by ConfigService (no process.env mutation side-effects).
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { generateText, streamText, LanguageModel } from 'ai';
import { MODELS, ModelConfig } from './models';
import { ConfigService, Provider } from '../services/config-service';

export interface AIResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class AIProvider {
  private readonly providers: Record<Provider, any> = {
    openai: undefined,
    anthropic: undefined,
    google: undefined,
    xai: undefined
  };

  private readonly config: ConfigService;

  constructor(configService?: ConfigService) {
    // Allow dependency-injection for testing
    this.config = configService ?? new ConfigService();
    this.initializeProviders();
  }

  /* ────────────────────────────
   * Initialisation
   * ──────────────────────────── */

  private initializeProviders() {
    const keys = this.config.getAllKeys();
    
    if (keys.openai) {
      this.providers.openai = createOpenAI({ apiKey: keys.openai });
    }
    if (keys.anthropic) {
      this.providers.anthropic = createAnthropic({ apiKey: keys.anthropic });
    }
    if (keys.google) {
      this.providers.google = createGoogleGenerativeAI({ apiKey: keys.google });
    }
    if (keys.xai) {
      this.providers.xai = createXai({ apiKey: keys.xai });
    }
  }

  /* ────────────────────────────
   * Helpers
   * ──────────────────────────── */

  
  private getModel(modelKey: string): LanguageModel {
    const config = MODELS[modelKey];
    if (!config) throw new Error(`Unknown model: ${modelKey}`);

    const providerInstance = this.providers[config.provider];
    if (!providerInstance) {
      const envName = config.provider.toUpperCase() + '_API_KEY';
      throw new Error(
        `API key not configured for ${config.provider}. ` +
          `Set via "promptcode config --set-${config.provider}-key <key>" ` +
          `or export ${envName}=...`
      );
    }

    return providerInstance(config.modelId);
  }

  /* ────────────────────────────
   * Public API
   * ──────────────────────────── */

  async generateText(
    modelKey: string,
    prompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
    } = {}
  ): Promise<AIResponse> {
    const model = this.getModel(modelKey);
    
    const messages: any[] = [];
    
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    const result = await generateText({
      model,
      messages,
      maxCompletionTokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
    });
    
    return {
      text: result.text,
      usage: result.usage ? {
        promptTokens: (result.usage as any).promptTokens || 0,
        completionTokens: (result.usage as any).completionTokens || 0,
        totalTokens: ((result.usage as any).promptTokens || 0) + ((result.usage as any).completionTokens || 0)
      } : undefined
    };
  }
  
  async streamText(
    modelKey: string,
    prompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
      onChunk?: (chunk: string) => void;
    } = {}
  ): Promise<AIResponse> {
    const model = this.getModel(modelKey);
    
    const messages: any[] = [];
    
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    const result = await streamText({
      model,
      messages,
      maxCompletionTokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
    });
    
    let fullText = '';
    for await (const chunk of result.textStream) {
      fullText += chunk;
      if (options.onChunk) {
        options.onChunk(chunk);
      }
    }
    
    // Get final usage
    const usage = await result.usage;
    
    return {
      text: fullText,
      usage: usage ? {
        promptTokens: (usage as any).promptTokens || 0,
        completionTokens: (usage as any).completionTokens || 0,
        totalTokens: ((usage as any).promptTokens || 0) + ((usage as any).completionTokens || 0)
      } : undefined
    };
  }
  
  calculateCost(
    modelKey: string,
    usage: { promptTokens: number; completionTokens: number }
  ): number {
    const config = MODELS[modelKey];
    if (!config) return 0;

    const input = (usage.promptTokens / 1_000_000) * config.pricing.input;
    const output = (usage.completionTokens / 1_000_000) * config.pricing.output;
    return input + output;
  }
}