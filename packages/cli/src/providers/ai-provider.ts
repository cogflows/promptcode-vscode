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

// Type-safe usage formats from different providers
type ProviderUsage = 
  | { inputTokens: number; outputTokens: number; totalTokens?: number }
  | { promptTokens: number; completionTokens: number; totalTokens?: number }
  | { tokensProcessed: number; tokensGenerated: number; totalTokens?: number };

// Field mapping for different SDK naming conventions
const TOKEN_FIELD_MAP = {
  prompt: ['inputTokens', 'promptTokens', 'tokensProcessed'],
  completion: ['outputTokens', 'completionTokens', 'tokensGenerated'],
  total: ['totalTokens']
} as const;

// Export for testing
export function normalizeUsage(usage?: ProviderUsage | any): AIResponse['usage'] | undefined {
  if (!usage) return undefined;
  
  // Helper to safely convert values to numbers
  const toNumber = (value: unknown): number => {
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  };
  
  // Helper to find first matching field from the map
  const findTokenValue = (fieldType: keyof typeof TOKEN_FIELD_MAP): number => {
    const fields = TOKEN_FIELD_MAP[fieldType];
    for (const field of fields) {
      if (field in usage) {
        return toNumber(usage[field as keyof typeof usage]);
      }
    }
    return 0;
  };
  
  // Extract token values using the field map
  const promptTokens = findTokenValue('prompt');
  const completionTokens = findTokenValue('completion');
  const totalTokens = findTokenValue('total') || (promptTokens + completionTokens);
  
  // Warn if we couldn't find any recognized token fields
  if (promptTokens === 0 && completionTokens === 0 && !('totalTokens' in usage)) {
    const knownFields = Object.values(TOKEN_FIELD_MAP).flat();
    const hasUnknownShape = !knownFields.some(field => field in usage);
    
    if (hasUnknownShape) {
      console.warn('[promptcode] Unknown usage object shape:', Object.keys(usage));
    }
  }
  
  return {
    promptTokens,
    completionTokens,
    totalTokens
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
    // Skip model initialization in mock mode
    if (process.env.PROMPTCODE_MOCK_LLM === '1') {
      return {} as LanguageModel; // Return dummy model object
    }
    
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
    // Mock mode for testing
    if (process.env.PROMPTCODE_MOCK_LLM === '1') {
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay
      return {
        text: 'Mock LLM response: This is a test response from the mock LLM. The code looks good and follows best practices.',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        }
      };
    }
    
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
      usage: normalizeUsage(result.usage)
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
    // Mock mode for testing
    if (process.env.PROMPTCODE_MOCK_LLM === '1') {
      const mockResponse = 'Mock LLM response: This is a streaming test response. The code has been analyzed successfully.';
      
      // Simulate streaming by chunking the response
      for (const word of mockResponse.split(' ')) {
        await new Promise(resolve => setTimeout(resolve, 10));
        if (options.onChunk) {
          options.onChunk(word + ' ');
        }
      }
      
      return {
        text: mockResponse,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        }
      };
    }
    
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
      usage: normalizeUsage(usage)
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