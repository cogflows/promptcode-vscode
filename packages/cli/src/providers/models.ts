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
 * Pricing last updated: December 2025
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
  vision: z.boolean().optional().default(false),
  visionLimits: z.object({
    maxImages: z.number().int().positive().optional(),
    maxImageBytes: z.number().int().positive().optional(),
    backgroundSupported: z.boolean().optional()
  }).optional(),
});

// Type derives from schema so TS & runtime always match
export type ModelConfig = z.infer<typeof ModelSchema>;

export const MODELS: Record<string, ModelConfig> = {
  // OpenAI GPT-5 models (August 2025 release)
  'gpt-5': {
    provider: 'openai',
    modelId: 'gpt-5',
    name: 'GPT-5',
    description: 'State-of-the-art model with superior coding and reasoning',
    contextWindow: 400000,
    pricing: { input: 1.25, output: 10 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, backgroundSupported: false }
  },
  'gpt-5-mini': {
    provider: 'openai',
    modelId: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    description: 'Balanced GPT-5 model for efficient performance',
    contextWindow: 400000,
    pricing: { input: 0.25, output: 2 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, backgroundSupported: false }
  },
  'gpt-5-nano': {
    provider: 'openai',
    modelId: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    description: 'Ultra-fast GPT-5 model for quick tasks',
    contextWindow: 400000,
    pricing: { input: 0.05, output: 0.4 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, backgroundSupported: false }
  },
  'gpt-5-pro': {
    provider: 'openai',
    modelId: 'gpt-5-pro',
    name: 'GPT-5 Pro',
    description: 'Most advanced reasoning model with extended thinking time',
    contextWindow: 400000,
    pricing: { input: 5, output: 20 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, backgroundSupported: false }
  },

  // OpenAI GPT-5.2 models (December 2025 release)
  'gpt-5.2': {
    provider: 'openai',
    modelId: 'gpt-5.2',
    name: 'GPT-5.2',
    description: 'Latest GPT-5 model with improved reliability and performance',
    contextWindow: 400000,
    pricing: { input: 1.75, output: 14 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, backgroundSupported: false }
  },
  'gpt-5.2-pro': {
    provider: 'openai',
    modelId: 'gpt-5.2-pro',
    name: 'GPT-5.2 Pro',
    description: 'Highest-end reasoning model with extended thinking time',
    contextWindow: 400000,
    pricing: { input: 21, output: 168 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, backgroundSupported: false }
  },

  // OpenAI GPT-5.1 models (November 2025 release - improved GPT-5)
  'gpt-5.1': {
    provider: 'openai',
    modelId: 'gpt-5.1',
    name: 'GPT-5.1',
    description: 'Improved GPT-5 with adaptive reasoning and better performance',
    contextWindow: 400000,
    pricing: { input: 1.25, output: 10 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, backgroundSupported: false }
  },
  'gpt-5.1-codex': {
    provider: 'openai',
    modelId: 'gpt-5.1-codex',
    name: 'GPT-5.1 Codex',
    description: 'Optimized for long-running agentic coding tasks',
    contextWindow: 400000,
    pricing: { input: 1.25, output: 10 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, backgroundSupported: false }
  },
  'gpt-5.1-codex-mini': {
    provider: 'openai',
    modelId: 'gpt-5.1-codex-mini',
    name: 'GPT-5.1 Codex Mini',
    description: 'Efficient model for simpler coding tasks',
    contextWindow: 400000,
    pricing: { input: 0.25, output: 2 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, backgroundSupported: false }
  },

  // OpenAI O3 models (reasoning specialists)
  'o3': {
    provider: 'openai',
    modelId: 'o3',
    name: 'O3',
    description: 'Reasoning-focused model with deep thinking capabilities',
    contextWindow: 200000,
    pricing: { input: 2, output: 8 },
    supportsWebSearch: true,
    vision: false
  },
  'o3-pro': {
    provider: 'openai',
    modelId: 'o3-pro',
    name: 'O3 Pro',
    description: 'Premium reasoning model with extended thinking time',
    contextWindow: 200000,
    pricing: { input: 20, output: 80 },
    supportsWebSearch: true,
    vision: false
  },
  'o3-mini': {
    provider: 'openai',
    modelId: 'o3-mini',
    name: 'O3 Mini',
    description: 'Fast reasoning model for quick tasks',
    contextWindow: 200000,
    pricing: { input: 0.5, output: 2 },
    supportsWebSearch: true,
    vision: false
  },
  
  // Anthropic models (2025 SOTA)
  'opus-4': {
    provider: 'anthropic',
    modelId: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Advanced Claude model with breakthrough capabilities',
    contextWindow: 500000,
    pricing: { input: 15, output: 75 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 20, maxImageBytes: 32 * 1024 * 1024, backgroundSupported: false }
  },
  'opus-4.1': {
    provider: 'anthropic',
    modelId: 'claude-opus-4-1-20250805',
    name: 'Claude Opus 4.1',
    description: 'Enhanced Opus with improved agentic tasks and coding',
    contextWindow: 500000,
    pricing: { input: 15, output: 75 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 20, maxImageBytes: 32 * 1024 * 1024, backgroundSupported: false }
  },
  'sonnet-4': {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    description: 'Balanced power and efficiency for production use',
    contextWindow: 500000,
    pricing: { input: 3, output: 15 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 20, maxImageBytes: 32 * 1024 * 1024, backgroundSupported: false }
  },
  'sonnet-4.5': {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    description: 'Most intelligent model with leading coding capabilities',
    contextWindow: 200000,
    pricing: { input: 3, output: 15 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 20, maxImageBytes: 32 * 1024 * 1024, backgroundSupported: false }
  },
  'haiku-4.5': {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251015',
    name: 'Claude Haiku 4.5',
    description: 'Fast and efficient model for real-time applications',
    contextWindow: 200000,
    pricing: { input: 1, output: 5 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 20, maxImageBytes: 32 * 1024 * 1024, backgroundSupported: false }
  },
  
  // Google models (2025 SOTA)
  'gemini-3-pro': {
    provider: 'google',
    modelId: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    description: 'Latest flagship with 1501 Elo score, top of LMArena',
    contextWindow: 1000000,
    pricing: { input: 2, output: 12 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 15, maxImageBytes: 15 * 1024 * 1024, backgroundSupported: false }
  },
  'gemini-2.5-pro': {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Powerful Gemini with enhanced multimodal understanding',
    contextWindow: 3000000,
    pricing: { input: 1.25, output: 10 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 15, maxImageBytes: 15 * 1024 * 1024, backgroundSupported: false }
  },
  'gemini-2.5-flash': {
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Ultra-fast model for real-time applications',
    contextWindow: 1000000,
    pricing: { input: 0.15, output: 0.6 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 15, maxImageBytes: 15 * 1024 * 1024, backgroundSupported: false }
  },
  
  // xAI models (2025 SOTA)
  // Note: Grok 4.1 not yet available via API (Nov 2025)
  'grok-4': {
    provider: 'xai',
    modelId: 'grok-4',
    name: 'Grok 4',
    description: 'xAI\'s powerful model with real-time web access',
    contextWindow: 200000,
    pricing: { input: 3, output: 15 },
    supportsWebSearch: true,
    vision: true,
    visionLimits: { maxImages: 10, maxImageBytes: 20 * 1024 * 1024, backgroundSupported: false }
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

// Default model - GPT-5.1 offers best performance with adaptive reasoning and reduced token usage
export const DEFAULT_MODEL = 'gpt-5.2';

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
