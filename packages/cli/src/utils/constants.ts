/**
 * Shared constants used across the CLI
 */

// Version used for cache invalidation
export const CACHE_VERSION = '0.1.0';

// Token counting constants
export const DEFAULT_SAFETY_MARGIN = 256;
export const DEFAULT_EXPECTED_COMPLETION = 4000;

// File system constants
export const PRESET_FILE_EXTENSION = '.patterns';
export const TEMPLATE_FILE_EXTENSION = '.md';
export const CONFIG_FILE_NAME = 'config.json';
export const HISTORY_FILE_NAME = 'history.json';
export const IGNORE_FILE_NAME = '.promptcode_ignore';

// CLI constants
export const MAX_HISTORY_ENTRIES = 100;
export const DEFAULT_DEBOUNCE_MS = 1000;

// Environment variable names
export const ENV_VARS = {
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  CLAUDE_API_KEY: 'CLAUDE_API_KEY',
  GOOGLE_API_KEY: 'GOOGLE_API_KEY',
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  XAI_API_KEY: 'XAI_API_KEY',
  GROK_API_KEY: 'GROK_API_KEY'
} as const;