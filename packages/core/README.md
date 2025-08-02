# @promptcode/core

Core functionality for PromptCode - shared between VS Code extension and CLI.

## Overview

This package provides the core logic for:
- File scanning with glob patterns and ignore rules
- Token counting with caching
- Prompt generation with structured output
- Utility functions for file trees and pattern generation

## Installation

```bash
npm install @promptcode/core
```

## API

### File Scanning

```typescript
import { scanFiles } from '@promptcode/core';

const files = await scanFiles({
  cwd: '/path/to/project',
  patterns: ['src/**/*.ts', '!**/*.test.ts'],
  respectGitignore: true,
  customIgnoreFile: '.promptcode_ignore',
  workspaceName: 'my-project'
});
```

### Prompt Building

```typescript
import { buildPrompt } from '@promptcode/core';

const result = await buildPrompt(files, instructions, {
  includeFiles: true,
  includeInstructions: true,
  includeFileContents: true
});

console.log(result.prompt);        // Generated prompt text
console.log(result.tokenCount);    // Total token count
console.log(result.sections);      // Token counts by section
```

### Token Counting

```typescript
import { 
  initializeTokenCounter, 
  countTokensWithCache,
  clearTokenCache 
} from '@promptcode/core';

// Initialize with cache directory
initializeTokenCounter('/path/to/cache', '1.0.0');

// Count tokens in a file
const tokens = await countTokensWithCache('/path/to/file.ts');

// Clear cache
clearTokenCache();
```

### Utilities

```typescript
import { 
  buildTreeFromSelection,
  generatePatternsFromSelection,
  listFilesByPattern 
} from '@promptcode/core';

// Build file tree
const tree = buildTreeFromSelection(selectedFiles);

// Generate patterns from selection
const patterns = generatePatternsFromSelection(paths, workspaceRoot);

// List files by pattern
const files = await listFilesByPattern('**/*.ts', '/project/root');
```

## Types

```typescript
export interface SelectedFile {
  path: string;                    // Relative path
  absolutePath: string;            // Absolute path
  tokenCount: number;              // Token count
  workspaceFolderRootPath: string; // Workspace root
  workspaceFolderName: string;     // Workspace name
  content?: string;                // Optional content
}

export interface ScanOptions {
  cwd: string;
  patterns: string[];
  respectGitignore: boolean;
  customIgnoreFile?: string;
  workspaceName?: string;
}

export interface PromptOptions {
  includeFiles: boolean;
  includeInstructions: boolean;
  includeFileContents?: boolean;
}

export interface PromptResult {
  prompt: string;
  tokenCount: number;
  sections: {
    instructions: number;
    fileMap: number;
    fileContents: number;
    resources: number;
  };
}
```

## License

MIT