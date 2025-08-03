import * as fs from 'fs';
import * as path from 'path';

/**
 * Supported providers and their corresponding ENV-VAR names.
 */
export type Provider = 'openai' | 'anthropic' | 'google' | 'xai';

const ENV_VAR_MAP: Record<Provider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  xai: 'XAI_API_KEY'
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
 * – Environment variables override keys defined in the JSON config file.
 */
export class ConfigService {
  private readonly configPath: string;
  private readonly fileKeys: Partial<ApiKeys>;
  private readonly mergedKeys: ApiKeys;

  constructor(customConfigPath?: string) {
    this.configPath = customConfigPath ?? this.resolveDefaultConfigPath();
    this.fileKeys = this.readConfigFile();
    this.mergedKeys = this.mergeWithEnv(this.fileKeys);
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

  private resolveDefaultConfigPath(): string {
    const cfgDir =
      process.env.XDG_CONFIG_HOME ||
      path.join(process.env.HOME || '', '.config');
    return path.join(cfgDir, 'promptcode', 'config.json');
  }

  private readConfigFile(): Partial<ApiKeys> {
    try {
      if (!fs.existsSync(this.configPath)) return {};
      const raw = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ApiKeys>;
      return parsed;
    } catch {
      // Ignore malformed JSON; fall back to env only.
      return {};
    }
  }

  private mergeWithEnv(fileKeys: Partial<ApiKeys>): ApiKeys {
    const merged: ApiKeys = { ...fileKeys };

    (Object.keys(ENV_VAR_MAP) as Provider[]).forEach((provider) => {
      const envVal = process.env[ENV_VAR_MAP[provider]];
      if (envVal?.trim()) merged[provider] = envVal.trim();
    });

    return merged;
  }
}