/**
 * Model configurations and provider setup
 * 
 * IMPORTANT: All pricing values are in USD per million tokens
 * - pricing.input: Cost per million input tokens
 * - pricing.output: Cost per million output tokens
 * 
 * Example: If a provider charges $0.001 per 1K tokens, 
 * the value here should be 1.0 (1000x conversion)
 * 
 * Pricing last updated: August 2025
 */

import { z } from 'zod';
import {
  ConfigService,
  Provider as ProviderName, // alias to avoid name clash with ModelConfig.provider
} from '../services/config-service';

/* ──────────────────────────────────────────────────────────
 * 1. Zod schema (runtime validation)
 * ────────────────────────────────────────────────────────── */
const ModelSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'xai']),
  modelId: z.string().min(1, 'modelId must be non-empty'),
  name: z.string().min(1, 'name must be non-empty'),
  description: z.string().optional().default(''),
  contextWindow: z.number().int().positive(),
  pricing: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
  }),
  supportsWebSearch: z.boolean().optional().default(false),
});

// Type derives from schema so TS & runtime always match
export type ModelConfig = z.infer<typeof ModelSchema>;

export const MODELS: Record<string, ModelConfig> = {
  // OpenAI GPT-5 models (Latest August 2025 release)
  'gpt-5': {
    provider: 'openai',
    modelId: 'gpt-5',
    name: 'GPT-5',
    description: 'State-of-the-art model with superior coding and reasoning',
    contextWindow: 256000,
    pricing: { input: 1.25, output: 10 },
    supportsWebSearch: true
  },
  'gpt-5-mini': {
    provider: 'openai',
    modelId: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    description: 'Balanced GPT-5 model for efficient performance',
    contextWindow: 256000,
    pricing: { input: 0.25, output: 2 },
    supportsWebSearch: true
  },
  'gpt-5-nano': {
    provider: 'openai',
    modelId: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    description: 'Ultra-fast GPT-5 model for quick tasks',
    contextWindow: 256000,
    pricing: { input: 0.05, output: 0.4 },
    supportsWebSearch: true
  },
  
  // OpenAI O3 models (reasoning specialists)
  'o3': {
    provider: 'openai',
    modelId: 'o3',
    name: 'O3',
    description: 'Reasoning-focused model with deep thinking capabilities',
    contextWindow: 200000,
    pricing: { input: 2, output: 8 },
    supportsWebSearch: true
  },
  'o3-pro': {
    provider: 'openai',
    modelId: 'o3-pro',
    name: 'O3 Pro',
    description: 'Premium reasoning model with extended thinking time',
    contextWindow: 200000,
    pricing: { input: 20, output: 80 },
    supportsWebSearch: true
  },
  'o3-mini': {
    provider: 'openai',
    modelId: 'o3-mini',
    name: 'O3 Mini',
    description: 'Fast reasoning model for quick tasks',
    contextWindow: 200000,
    pricing: { input: 0.5, output: 2 },
    supportsWebSearch: true
  },
  
  // Anthropic models (2025 SOTA)
  'opus-4': {
    provider: 'anthropic',
    modelId: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Most advanced Claude model with breakthrough capabilities',
    contextWindow: 500000,
    pricing: { input: 15, output: 75 },
    supportsWebSearch: true
  },
  'sonnet-4': {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    description: 'Balanced power and efficiency for production use',
    contextWindow: 500000,
    pricing: { input: 3, output: 15 },
    supportsWebSearch: true
  },
  
  // Google models (2025 SOTA)
  'gemini-2.5-pro': {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Latest Gemini with enhanced multimodal understanding',
    contextWindow: 3000000,
    pricing: { input: 1.25, output: 10 },
    supportsWebSearch: true
  },
  'gemini-2.5-flash': {
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Ultra-fast model for real-time applications',
    contextWindow: 1000000,
    pricing: { input: 0.15, output: 0.6 },
    supportsWebSearch: true
  },
  
  // xAI models (2025 SOTA)
  'grok-4': {
    provider: 'xai',
    modelId: 'grok-4',
    name: 'Grok 4',
    description: 'xAI\'s most advanced model with real-time web access',
    contextWindow: 200000,
    pricing: { input: 3, output: 15 },
    supportsWebSearch: true
  }
};

/* ──────────────────────────────────────────────────────────
 * 2. Validate models immediately at module load
 * ────────────────────────────────────────────────────────── */
for (const [key, cfg] of Object.entries(MODELS)) {
  const res = ModelSchema.safeParse(cfg);
  if (!res.success) {
    // Make the error very explicit and actionable
    throw new Error(
      `Invalid model configuration for "${key}":\n` +
        res.error.issues.map(i => ` • ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
}

// Default model - GPT-5 offers best performance with 50-80% fewer tokens than O3
export const DEFAULT_MODEL = 'gpt-5';

// Get available models for a provider
export function getProviderModels(provider: string): string[] {
  return Object.entries(MODELS)
    .filter(([_, config]) => config.provider === provider)
    .map(([key]) => key);
}

/* ------------------------------------------------------------------ */
/*  Config look-up helpers (uses ConfigService instead of process.env) */
/* ------------------------------------------------------------------ */

/**
 * Singleton used when the caller does not provide its own ConfigService.
 * Keeps the helpers side-effect free while offering a zero-config API.
 */
const defaultConfig = new ConfigService();

/**
 * Check whether an API key exists for a provider.
 *
 * @param provider  The provider name ('openai' | 'anthropic' | 'google' | 'xai')
 * @param configSvc Optional ConfigService – pass a stub in unit tests.
 */
export function hasProviderKey(
  provider: ProviderName,
  configSvc: ConfigService = defaultConfig,
): boolean {
  return Boolean(configSvc.getApiKey(provider));
}

/**
 * Return the list of models whose providers have an API key configured.
 *
 * @param configSvc Optional ConfigService – pass a stub in unit tests.
 */
export function getAvailableModels(
  configSvc: ConfigService = defaultConfig,
): string[] {
  return Object.entries(MODELS)
    .filter(([, cfg]) => hasProviderKey(cfg.provider, configSvc))
    .map(([key]) => key);
}