/**
 * AI Provider using Vercel AI SDK
 *
 * Now powered by ConfigService (no process.env mutation side-effects).
 * Includes background mode support for long-running requests (GPT-5 Pro, O3 Pro).
 */

import { createOpenAI, openai } from '@ai-sdk/openai';
import { createAnthropic, anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI, google } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { generateText, LanguageModel } from 'ai';
import { MODELS, ModelConfig } from './models';
import { ConfigService, Provider } from '../services/config-service';
import { Agent } from 'undici';
import { BackgroundTaskHandler } from './background-task-handler.js';
import type { BackgroundTaskOptions } from '../types/background-task.js';

export interface AIResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  ranInBackground?: boolean;
  webSearchUsed?: boolean;
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

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string;
};

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
  private backgroundHandler: BackgroundTaskHandler | null = null;
  private extendedFetch: typeof fetch | null = null;

  constructor(configService?: ConfigService) {
    // Allow dependency-injection for testing
    this.config = configService ?? new ConfigService();
    this.initializeProviders();
  }

  /* ────────────────────────────
   * Initialisation
   * ──────────────────────────── */

  /**
   * Custom fetch wrapper that supports extended timeouts for long-running requests
   *
   * CRITICAL ISSUE DISCOVERED:
   * - Bun has a hard-coded 5-minute network timeout for fetch (source: https://bun.com/blog/bun-v1.0.4)
   * - This timeout OVERRIDES AbortSignal, undici Agent settings, and everything else
   * - Solution: Use Bun's `timeout: false` extension to disable the 5-minute cap
   *
   * For Node.js:
   * - Use undici Agent with extended timeouts (headersTimeout, bodyTimeout, keepAliveMaxTimeout)
   * - Our AbortController provides the actual per-request timeout
   *
   * This allows GPT-5 Pro and O3 Pro requests to run for up to 120 minutes in both runtimes.
   */
  private createFetchWithExtendedTimeout() {
    const MAX_TIMEOUT_MS = Number(process.env.PROMPTCODE_TIMEOUT_CAP_MS) || 7200000; // 120 minutes
    const isBun = typeof process !== 'undefined' && 'versions' in process && 'bun' in process.versions;

    if (isBun) {
      // BUN: Disable Bun's built-in 5-minute fetch timeout
      // Bun-specific extension: timeout: false (see https://bun.com/blog/bun-v1.0.4)
      return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (process.env.DEBUG) {
          console.error(`[DEBUG CUSTOM FETCH] Runtime: Bun`);
          console.error(`[DEBUG CUSTOM FETCH] URL: ${input}`);
          console.error(`[DEBUG CUSTOM FETCH] Using timeout: false to disable Bun's 5-minute fetch timeout`);
        }

        return fetch(input, {
          ...init,
          // @ts-expect-error - Bun-specific extension: timeout: false disables the 5-minute network timeout
          timeout: false,
        });
      };
    } else {
      // NODE: Use undici Agent with extended timeouts
      const agent = new Agent({
        connectTimeout: 30000, // 30s to establish connection (reasonable)
        headersTimeout: MAX_TIMEOUT_MS, // 120min to receive headers (GPT-5 Pro can think for a long time)
        bodyTimeout: MAX_TIMEOUT_MS, // 120min between body chunks
        keepAliveMaxTimeout: MAX_TIMEOUT_MS, // 120min max keepalive (default: 10min)
        keepAliveTimeout: 300000, // 5min idle keepalive (reasonable for most requests)
      });

      return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (process.env.DEBUG) {
          console.error(`[DEBUG CUSTOM FETCH] Runtime: Node.js`);
          console.error(`[DEBUG CUSTOM FETCH] URL: ${input}`);
          console.error(`[DEBUG CUSTOM FETCH] Using undici Agent with extended timeouts (headers=${MAX_TIMEOUT_MS}ms, body=${MAX_TIMEOUT_MS}ms, keepAliveMax=${MAX_TIMEOUT_MS}ms)`);
        }

        return fetch(input, {
          ...init,
          // @ts-expect-error - undici Agent is valid for Node.js fetch but TypeScript doesn't know
          dispatcher: agent,
        });
      };
    }
  }

  private getExtendedFetch(): typeof fetch {
    if (!this.extendedFetch) {
      this.extendedFetch = this.createFetchWithExtendedTimeout() as typeof fetch;
    }
    return this.extendedFetch;
  }

  private initializeProviders() {
    const keys = this.config.getAllKeys();

    if (keys.openai) {
      // CRITICAL: Custom fetch implementation to support extended timeouts
      // - Node.js fetch (undici) has hardcoded 300s (5 min) timeouts
      // - We use undici Agent with 120min timeouts for headers and body
      // - This allows GPT-5 Pro/O3 Pro requests to run for up to 120 minutes
      // - Our AbortController in generateText provides the actual per-request timeout
      this.providers.openai = createOpenAI({
        apiKey: keys.openai,
        fetch: this.getExtendedFetch(),
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
  private getModelTimeout(modelKey: string, reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' = 'high'): number {
    // Base timeouts by model tier
    const BASE_TIMEOUTS = {
      fast: 120000,      // 2 minutes
      standard: 300000,  // 5 minutes
      pro: 1800000,      // 30 minutes
    };

    // Reasoning effort multipliers (validated through real-world testing)
    const EFFORT_MULTIPLIERS: Record<string, number> = {
      none: 0.25,  // GPT-5.1 default - no reasoning tokens, fast responses
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
    } else if (modelKey.includes('codex-mini') || modelKey.includes('nano') || modelKey.includes('haiku') || modelKey.includes('flash')) {
      tier = 'fast';
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

  /**
   * Initialize background handler lazily (only when needed)
   */
  private getBackgroundHandler(): BackgroundTaskHandler {
    if (!this.backgroundHandler) {
      const apiKey = this.config.getAllKeys().openai;
      if (!apiKey) {
        throw new Error('OpenAI API key required for background tasks');
      }
      this.backgroundHandler = new BackgroundTaskHandler(apiKey, {
        fetch: this.getExtendedFetch(),
      });
    }
    return this.backgroundHandler;
  }

  /**
   * Determine if request should use background mode.
   *
   * Rules:
   * - Only supported for OpenAI-backed models.
   * - Explicit CLI/env disable wins.
   * - Explicit CLI/env force enables it.
   * - Otherwise defaults on for GPT-5 Pro.
   */
  private shouldUseBackgroundMode(
    modelKey: string,
    options: {
      forceBackgroundMode?: boolean;
      disableBackgroundMode?: boolean;
      disableProgress?: boolean;
    } = {}
  ): boolean {
    const config = MODELS[modelKey];
    if (!config || config.provider !== 'openai') {
      return false;
    }

    if (options.disableBackgroundMode) {
      return false;
    }

    if (process.env.PROMPTCODE_DISABLE_BACKGROUND === '1') {
      return false;
    }

    if (options.forceBackgroundMode) {
      return true;
    }

    if (process.env.PROMPTCODE_FORCE_BACKGROUND === '1') {
      if (process.env.DEBUG && !options.disableProgress) {
        console.error(`\n🔄 Background mode forced via PROMPTCODE_FORCE_BACKGROUND for model ${modelKey}\n`);
      }
      return true;
    }

    if (modelKey === 'gpt-5-pro') {
      if (process.env.DEBUG && !options.disableProgress) {
        console.error(`\n🔄 Defaulting to background mode for ${modelKey}\n`);
      }
      return true;
    }

    return false;
  }

  /**
   * Generate text using OpenAI's background mode API
   *
   * This method is used for long-running requests that would timeout
   * with the standard synchronous API (>5 minutes).
   */
  private async generateTextBackground(
    modelKey: string,
    prompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
      textVerbosity?: 'low' | 'medium' | 'high';
      reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
      serviceTier?: 'auto' | 'flex' | 'priority';
      disableProgress?: boolean;
      fallbackAttempted?: boolean;
    } = {}
  ): Promise<AIResponse> {
    const handler = this.getBackgroundHandler();

    const messages = [{ role: 'user' as const, content: prompt }];

    const backgroundOptions: BackgroundTaskOptions = {
      modelKey,
      messages,
      systemPrompt: options.systemPrompt,
      maxTokens: options.maxTokens, // Let API use its natural maximum if not specified
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort || 'high',
      textVerbosity: options.textVerbosity ?? 'low',
      webSearch: false, // Background mode doesn't support web search
      serviceTier: options.serviceTier,
      disableProgress: options.disableProgress,
    };

    const maxWaitTimeMs = this.getModelTimeout(modelKey, backgroundOptions.reasoningEffort);
    const result = await handler.execute(backgroundOptions, {
      maxWaitTimeMs,
    });

    // Convert background result to our AIResponse format
    return {
      text: result.text,
      usage: {
        promptTokens: result.usage.inputTokens,
        completionTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
      ranInBackground: true,
      webSearchUsed: false,
    };
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
    // Just return the standard model - web search tools will be added in generateText
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
      reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
      serviceTier?: 'auto' | 'flex' | 'priority';
      forceBackgroundMode?: boolean;
      disableBackgroundMode?: boolean;
      disableProgress?: boolean;
      autoBackgroundFallback?: boolean;
      fallbackAttempted?: boolean;
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

    // Check if we should use background mode for this request
    if (this.shouldUseBackgroundMode(modelKey, options)) {
      return this.generateTextBackground(modelKey, prompt, options);
    }

    const modelConfig = MODELS[modelKey];
    const enableWebSearch = options.webSearch !== false && modelConfig?.supportsWebSearch;
    const model = this.getModel(modelKey, enableWebSearch);

    const messages: ChatMessage[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    // Prepare the request configuration with dynamic timeout based on reasoning effort
    const reasoningEffort = options.reasoningEffort || 'high';
    const timeoutMs = this.getModelTimeout(modelKey, reasoningEffort);

    // Use AbortSignal.timeout for reliable long-duration support across Node.js and Bun
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    if (modelKey.includes('gpt-5-pro') || process.env.DEBUG) {
      console.error(`[DEBUG generateText] Using AbortSignal.timeout with ${timeoutMs}ms (${timeoutMs / 60000} minutes)`);
    }

    const requestConfig: Record<string, unknown> = {
      model,
      messages,
      abortSignal: timeoutSignal,
    };

    // Only set maxTokens if explicitly provided - let API use its natural maximum
    if (options.maxTokens) {
      requestConfig.maxTokens = options.maxTokens;
    }

    // Only add temperature for non-reasoning models (reasoning models ignore it)
    if (!modelKey.startsWith('gpt-5') && !modelKey.startsWith('o3')) {
      requestConfig.temperature = options.temperature || 0.7;
    }

    // Add GPT-5/GPT-5.1 specific parameters with smart defaults
    if (modelConfig?.provider === 'openai' && modelKey.startsWith('gpt-5')) {
      // Default to low verbosity for concise responses
      requestConfig.textVerbosity = options.textVerbosity || 'low';
      // Use the reasoning effort passed to the function
      // GPT-5.1 supports "none" as default for non-reasoning behavior
      requestConfig.reasoningEffort = reasoningEffort;
      if (options.serviceTier) {
        requestConfig.serviceTier = options.serviceTier;
      }
      // Enable 24-hour prompt caching for GPT-5.1 models (cost optimization)
      if (modelKey.startsWith('gpt-5.1')) {
        requestConfig.promptCacheRetention = '24h';
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
      const result = await generateText(requestConfig as Parameters<typeof generateText>[0]);

      return {
        text: result.text,
        usage: normalizeUsage(result.usage),
        ranInBackground: false,
        webSearchUsed: enableWebSearch,
      };
    } catch (error: unknown) {
      const errorRecord = (typeof error === 'object' && error !== null) ? (error as Record<string, unknown>) : undefined;
      const errorMessage = error instanceof Error
        ? error.message
        : typeof errorRecord?.message === 'string'
          ? errorRecord.message
          : String(error);
      const normalizedMessage = errorMessage.toLowerCase();
      const isTimeoutError = normalizedMessage.includes('timeout') || normalizedMessage.includes('timed out');
      // Debug: Log timeout errors with details
      if (isTimeoutError) {
        const errorName = error instanceof Error ? error.constructor.name : typeof error;
        const errorCode = typeof errorRecord?.code === 'string' ? errorRecord.code : undefined;
        const errorCause = errorRecord?.cause;
        console.error(`[DEBUG TIMEOUT ERROR] Message: ${errorMessage}`);
        console.error(`[DEBUG TIMEOUT ERROR] Error type: ${errorName}`);
        if (errorCode) {
          console.error(`[DEBUG TIMEOUT ERROR] Error code: ${errorCode}`);
        }
        if (errorCause) {
          console.error(`[DEBUG TIMEOUT ERROR] Error cause: ${errorCause}`);
        }
        if (error instanceof Error && error.stack) {
          console.error(`[DEBUG TIMEOUT ERROR] Stack:`, error.stack.split('\n').slice(0, 5).join('\n'));
        }
        const supportsBackground = modelConfig?.provider === 'openai';
        const backgroundDisabledExplicitly =
          options.disableBackgroundMode === true ||
          process.env.PROMPTCODE_DISABLE_BACKGROUND === '1';
        const autoFallbackRequested =
          options.autoBackgroundFallback === true ||
          process.env.PROMPTCODE_FALLBACK_BACKGROUND === '1';

        if (
          supportsBackground &&
          !options.forceBackgroundMode &&
          !backgroundDisabledExplicitly &&
          autoFallbackRequested &&
          !options.fallbackAttempted
        ) {
          if (!options.disableProgress && process.env.PROMPTCODE_TEST !== '1') {
            console.error('💡 Timeout detected. Falling back to OpenAI background mode automatically (set PROMPTCODE_FALLBACK_BACKGROUND=0 to opt out).');
          }
          return this.generateTextBackground(modelKey, prompt, {
            maxTokens: options.maxTokens,
            temperature: options.temperature,
            systemPrompt: options.systemPrompt,
            textVerbosity: options.textVerbosity,
            reasoningEffort,
            serviceTier: options.serviceTier,
            disableProgress: options.disableProgress,
            fallbackAttempted: true,
          });
        }

        if (
          supportsBackground &&
          !options.forceBackgroundMode &&
          !backgroundDisabledExplicitly &&
          process.env.PROMPTCODE_FALLBACK_BACKGROUND !== '1'
        ) {
          console.error('💡 Timeout detected. Re-run with --background (or set PROMPTCODE_FALLBACK_BACKGROUND=1 for automatic fallback) to let the model finish offline.');
        }
      }
      throw error;
    }
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
