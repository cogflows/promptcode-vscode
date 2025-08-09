/**
 * AI Provider using Vercel AI SDK
 *
 * Now powered by ConfigService (no process.env mutation side-effects).
 */

import { createOpenAI, openai } from '@ai-sdk/openai';
import { createAnthropic, anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI, google } from '@ai-sdk/google';
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

  private getWebSearchTools(modelKey: string): Record<string, any> | undefined {
    const config = MODELS[modelKey];
    if (!config || !config.supportsWebSearch) return undefined;

    switch (config.provider) {
      case 'openai':
        // OpenAI requires using the responses API for web search
        // This is handled in getModel method with a special case
        return {
          web_search_preview: openai.tools.webSearchPreview({})
        };
      
      case 'google':
        return {
          google_search: google.tools.googleSearch({})
        };
      
      case 'anthropic':
        // Anthropic web search tool - using the provider-defined tool
        return {
          web_search: anthropic.tools.webSearch_20250305({
            maxUses: 5
          })
        };
      
      case 'xai':
        // xAI Grok has built-in web access, no explicit tool needed
        return undefined;
      
      default:
        return undefined;
    }
  }
  
  private getModel(modelKey: string, useWebSearch: boolean = false): LanguageModel {
    // Skip model initialization in mock mode
    if (process.env.PROMPTCODE_MOCK_LLM === '1') {
      return {} as LanguageModel; // Return dummy model object
    }
    
    const config = MODELS[modelKey];
    if (!config) throw new Error(`Unknown model: ${modelKey}`);

    // Special handling for OpenAI with web search
    if (config.provider === 'openai' && useWebSearch && config.supportsWebSearch) {
      const keys = this.config.getAllKeys();
      if (!keys.openai) {
        throw new Error(
          `API key not configured for openai. ` +
          `Set via environment variable: export OPENAI_API_KEY=...`
        );
      }
      // Use responses API for web search support
      const openaiProvider = createOpenAI({ apiKey: keys.openai });
      return openaiProvider.responses(config.modelId);
    }

    const providerInstance = this.providers[config.provider];
    if (!providerInstance) {
      const envName = config.provider.toUpperCase() + '_API_KEY';
      throw new Error(
        `API key not configured for ${config.provider}. ` +
          `Set via environment variable: export ${envName}=...`
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
      webSearch?: boolean;
      textVerbosity?: 'low' | 'medium' | 'high';
      reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
      serviceTier?: 'auto' | 'flex' | 'priority';
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
    
    const modelConfig = MODELS[modelKey];
    const enableWebSearch = options.webSearch !== false && modelConfig?.supportsWebSearch;
    const model = this.getModel(modelKey, enableWebSearch);
    
    const messages: any[] = [];
    
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    // Prepare the request configuration
    const requestConfig: any = {
      model,
      messages,
      maxCompletionTokens: options.maxTokens || 4096,
    };
    
    // Only add temperature for non-GPT-5 models (GPT-5 doesn't support it)
    if (!modelKey.startsWith('gpt-5')) {
      requestConfig.temperature = options.temperature || 0.7;
    }
    
    // Add GPT-5 specific parameters with smart defaults
    if (modelConfig?.provider === 'openai' && modelKey.startsWith('gpt-5')) {
      // Default to low verbosity for concise responses
      requestConfig.textVerbosity = options.textVerbosity || 'low';
      // Default to high reasoning effort for best quality
      requestConfig.reasoningEffort = options.reasoningEffort || 'high';
      if (options.serviceTier) {
        requestConfig.serviceTier = options.serviceTier;
      }
    }
    
    // Add web search tools if enabled
    if (enableWebSearch) {
      const tools = this.getWebSearchTools(modelKey);
      if (tools) {
        requestConfig.tools = tools;
      }
    }
    
    const result = await generateText(requestConfig);
    
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
      webSearch?: boolean;
      textVerbosity?: 'low' | 'medium' | 'high';
      reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
      serviceTier?: 'auto' | 'flex' | 'priority';
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
    
    const modelConfig = MODELS[modelKey];
    const enableWebSearch = options.webSearch !== false && modelConfig?.supportsWebSearch;
    const model = this.getModel(modelKey, enableWebSearch);
    
    const messages: any[] = [];
    
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    // Prepare the request configuration
    const requestConfig: any = {
      model,
      messages,
      maxCompletionTokens: options.maxTokens || 4096,
    };
    
    // Only add temperature for non-GPT-5 models (GPT-5 doesn't support it)
    if (!modelKey.startsWith('gpt-5')) {
      requestConfig.temperature = options.temperature || 0.7;
    }
    
    // Add GPT-5 specific parameters with smart defaults
    if (modelConfig?.provider === 'openai' && modelKey.startsWith('gpt-5')) {
      // Default to low verbosity for concise responses
      requestConfig.textVerbosity = options.textVerbosity || 'low';
      // Default to high reasoning effort for best quality
      requestConfig.reasoningEffort = options.reasoningEffort || 'high';
      if (options.serviceTier) {
        requestConfig.serviceTier = options.serviceTier;
      }
    }
    
    // Add web search tools if enabled
    if (enableWebSearch) {
      const tools = this.getWebSearchTools(modelKey);
      if (tools) {
        requestConfig.tools = tools;
      }
    }
    
    const result = await streamText(requestConfig);
    
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