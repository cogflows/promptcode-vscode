
/**
 * Supported providers and their corresponding ENV-VAR names.
 */
export type Provider = 'openai' | 'anthropic' | 'google' | 'xai';

// Support multiple env var names for each provider (first match wins)
const ENV_VAR_MAP: Record<Provider, string[]> = {
  openai: ['OPENAI_API_KEY', 'OPENAI_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GOOGLE_CLOUD_API_KEY', 'GOOGLE_AI_API_KEY', 'GEMINI_API_KEY'],
  xai: ['XAI_API_KEY', 'GROK_API_KEY']
};

export interface ApiKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
  xai?: string;
}

/**
 * Lightweight service for reading PromptCode configuration.
 * – NO side-effects (does **not** write to process.env).
 * – Only reads API keys from environment variables (no file storage).
 */
export class ConfigService {
  private readonly mergedKeys: ApiKeys;

  constructor() {
    this.mergedKeys = this.readFromEnv();
  }

  /**
   * Get an API key for a specific provider.
   * Returns undefined when no key is found.
   */
  getApiKey(provider: Provider): string | undefined {
    return this.mergedKeys[provider];
  }

  /**
   * Get the full (merged) key map.
   */
  getAllKeys(): ApiKeys {
    // Return a shallow copy to keep the class immutable from outside.
    return { ...this.mergedKeys };
  }

  /* ────────────────────────────
   * Internal helpers
   * ──────────────────────────── */

  private readFromEnv(): ApiKeys {
    const keys: ApiKeys = {};

    (Object.keys(ENV_VAR_MAP) as Provider[]).forEach((provider) => {
      // Check each possible env var name for this provider
      for (const envName of ENV_VAR_MAP[provider]) {
        const envVal = process.env[envName];
        if (envVal?.trim()) {
          keys[provider] = envVal.trim();
          break; // Use first match
        }
      }
    });

    return keys;
  }
}