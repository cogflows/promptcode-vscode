export interface FilePreset {
  name: string;          // e.g., "openli-web fe&be"
  files?: string[];      // Legacy: relative paths e.g. ["apps/openli-web/src/App.tsx", ...]
  patternFile?: string;  // New: path to .patterns file
  legacyFile?: string;   // For migration: path to old JSON file
} 