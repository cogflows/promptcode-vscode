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
  if (!usage) {return undefined;}
  
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
      this.providers.openai = createOpenAI({
        apiKey: keys.openai,
      });
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

  /**
   * Get appropriate timeout for a model based on its capabilities and reasoning effort
   *
   * Extended reasoning models (GPT-5 Pro, O3 Pro) can take 60-120+ minutes per request
   * with high reasoning effort. Timeout scales dynamically based on effort level.
   *
   * Base timeouts (in milliseconds):
   * - Pro reasoning models: 30 minutes (1800000ms)
   * - Standard reasoning models: 5 minutes (300000ms)
   * - Fast models: 2 minutes (120000ms)
   *
   * Reasoning effort multipliers (validated through real-world testing):
   * - minimal: 0.5x (15 minutes for pro models)
   * - low: 1x (30 minutes for pro models)
   * - medium: 2x (60 minutes for pro models)
   * - high: 4x (120 minutes for pro models - validated with actual GPT-5 Pro consultations)
   *
   * Environment variable overrides:
   * - PROMPTCODE_TIMEOUT_MS: Global timeout override
   * - PROMPTCODE_TIMEOUT_<MODEL>_MS: Model-specific override (e.g., PROMPTCODE_TIMEOUT_GPT_5_PRO_MS)
   * - PROMPTCODE_TIMEOUT_CAP_MS: Maximum timeout cap (default: 7200000ms = 120 minutes)
   */
  private getModelTimeout(modelKey: string, reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' = 'high'): number {
    // Base timeouts by model tier
    const BASE_TIMEOUTS = {
      fast: 120000,      // 2 minutes
      standard: 300000,  // 5 minutes
      pro: 1800000,      // 30 minutes
    };

    // Reasoning effort multipliers (validated through real-world testing)
    const EFFORT_MULTIPLIERS: Record<string, number> = {
      minimal: 0.5,
      low: 1,
      medium: 2,
      high: 4,  // For 60-120 minute extended reasoning (real GPT-5 Pro consultations)
    };

    // Maximum timeout cap to prevent runaway (increased from 60min after real-world testing)
    const MAX_CAP = Number(process.env.PROMPTCODE_TIMEOUT_CAP_MS) || 7200000; // 120 minutes

    // Determine model tier
    const config = MODELS[modelKey];
    let tier: 'fast' | 'standard' | 'pro';

    if (!config) {
      tier = 'standard'; // Unknown model, use safe default
    } else if (modelKey === 'gpt-5-pro' || modelKey === 'o3-pro') {
      tier = 'pro';
    } else if (modelKey.startsWith('o3') || modelKey.startsWith('gpt-5')) {
      tier = 'standard';
    } else {
      tier = 'fast';
    }

    // Calculate timeout with effort multiplier
    const baseTimeout = BASE_TIMEOUTS[tier];
    const multiplier = EFFORT_MULTIPLIERS[reasoningEffort] || 1;
    const calculatedTimeout = Math.min(baseTimeout * multiplier, MAX_CAP);

    // Debug logging for timeout calculation
    if (process.env.DEBUG || modelKey.includes('gpt-5-pro')) {
      console.error(`[DEBUG getModelTimeout] modelKey=${modelKey}, tier=${tier}, reasoningEffort=${reasoningEffort}, baseTimeout=${baseTimeout}ms, multiplier=${multiplier}, calculatedTimeout=${calculatedTimeout}ms, MAX_CAP=${MAX_CAP}ms`);
    }

    // Check for model-specific environment variable override
    // Normalize model key: gpt-5-pro -> GPT_5_PRO
    const normalizedModelKey = modelKey.toUpperCase().replace(/[-.]/g, '_');
    const modelSpecificEnv = process.env[`PROMPTCODE_TIMEOUT_${normalizedModelKey}_MS`];
    if (modelSpecificEnv) {
      const overrideTimeout = Number(modelSpecificEnv);
      if (!isNaN(overrideTimeout) && overrideTimeout > 0) {
        return Math.min(overrideTimeout, MAX_CAP);
      }
    }

    // Check for global environment variable override
    const globalEnv = process.env.PROMPTCODE_TIMEOUT_MS;
    if (globalEnv) {
      const overrideTimeout = Number(globalEnv);
      if (!isNaN(overrideTimeout) && overrideTimeout > 0) {
        return Math.min(overrideTimeout, MAX_CAP);
      }
    }

    return calculatedTimeout;
  }

  private getWebSearchTools(modelKey: string): Record<string, any> | undefined {
    const config = MODELS[modelKey];
    if (!config || !config.supportsWebSearch) {return undefined;}

    // Check if the provider is initialized before trying to use its tools
    const providerInstance = this.providers[config.provider];
    if (!providerInstance) {
      // Provider not initialized (no API key), can't use web search tools
      return undefined;
    }

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
    if (!config) {throw new Error(`Unknown model: ${modelKey}`);}

    // Web search is handled via tools in getWebSearchTools(), not via a separate API
    // Just return the standard model - web search tools will be added in generateText/streamText
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

    // Prepare the request configuration with dynamic timeout based on reasoning effort
    const reasoningEffort = options.reasoningEffort || 'high';
    const timeoutMs = this.getModelTimeout(modelKey, reasoningEffort);

    // Debug: Log the timeout value being used for AbortSignal
    if (modelKey.includes('gpt-5-pro') || process.env.DEBUG) {
      console.error(`[DEBUG generateText/streamText] Creating AbortSignal with timeout: ${timeoutMs}ms (${timeoutMs/60000} minutes)`);
    }

    const requestConfig: any = {
      model,
      messages,
      maxTokens: options.maxTokens || 4096,
      abortSignal: AbortSignal.timeout(timeoutMs),
    };

    // Only add temperature for non-reasoning models (reasoning models ignore it)
    if (!modelKey.startsWith('gpt-5') && !modelKey.startsWith('o3')) {
      requestConfig.temperature = options.temperature || 0.7;
    }

    // Add GPT-5 specific parameters with smart defaults
    if (modelConfig?.provider === 'openai' && modelKey.startsWith('gpt-5')) {
      // Default to low verbosity for concise responses
      requestConfig.textVerbosity = options.textVerbosity || 'low';
      // Use the reasoning effort passed to the function
      requestConfig.reasoningEffort = reasoningEffort;
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

    try {
      const result = await generateText(requestConfig);

      return {
        text: result.text,
        usage: normalizeUsage(result.usage)
      };
    } catch (error: any) {
      // Debug: Log timeout errors with details
      if (error.message?.includes('timeout') || error.message?.includes('timed out')) {
        console.error(`[DEBUG TIMEOUT ERROR] Message: ${error.message}`);
        console.error(`[DEBUG TIMEOUT ERROR] Error type: ${error.constructor.name}`);
        console.error(`[DEBUG TIMEOUT ERROR] Error code: ${error.code}`);
        console.error(`[DEBUG TIMEOUT ERROR] Error cause: ${error.cause}`);
        console.error(`[DEBUG TIMEOUT ERROR] Stack:`, error.stack?.split('\n').slice(0, 5).join('\n'));
      }
      throw error;
    }
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

    // Prepare the request configuration with dynamic timeout based on reasoning effort
    const reasoningEffort = options.reasoningEffort || 'high';
    const timeoutMs = this.getModelTimeout(modelKey, reasoningEffort);

    // Debug: Log the timeout value being used for AbortSignal
    if (modelKey.includes('gpt-5-pro') || process.env.DEBUG) {
      console.error(`[DEBUG generateText/streamText] Creating AbortSignal with timeout: ${timeoutMs}ms (${timeoutMs/60000} minutes)`);
    }

    const requestConfig: any = {
      model,
      messages,
      maxTokens: options.maxTokens || 4096,
      abortSignal: AbortSignal.timeout(timeoutMs),
    };

    // Only add temperature for non-reasoning models (reasoning models ignore it)
    if (!modelKey.startsWith('gpt-5') && !modelKey.startsWith('o3')) {
      requestConfig.temperature = options.temperature || 0.7;
    }

    // Add GPT-5 specific parameters with smart defaults
    if (modelConfig?.provider === 'openai' && modelKey.startsWith('gpt-5')) {
      // Default to low verbosity for concise responses
      requestConfig.textVerbosity = options.textVerbosity || 'low';
      // Use the reasoning effort passed to the function
      requestConfig.reasoningEffort = reasoningEffort;
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
    if (!config) {return 0;}

    const input = (usage.promptTokens / 1_000_000) * config.pricing.input;
    const output = (usage.completionTokens / 1_000_000) * config.pricing.output;
    return input + output;
  }
}