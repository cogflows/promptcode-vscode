# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptCode is a VS Code extension that bridges codebases with AI models. It helps developers generate structured prompts by selecting specific files and adding custom instructions, working with any AI model including non-API ones like o1-pro or Grok.

## Common Development Commands

### Build Commands
- `npm run compile` - Development build with source maps
- `npm run build:prod` - Production build with minification, no source maps
- `npm run watch` - Watch mode for auto-rebuilds during development

### Testing & Linting
- `npm test` - Run linting (no unit tests currently)
- `npm run lint` - Run ESLint on source files

### Debugging
- Run `npm run watch` then press F5 in VS Code to launch a new Extension Development Host window

## Architecture Overview

### Core Structure
The extension follows a standard VS Code extension architecture with a main extension entry point and a webview-based UI:

1. **Extension Core** (`src/extension.ts`) - Handles activation, command registration, and orchestrates all components

2. **Webview System** - Multi-tab interface managed by `webviewProvider.ts`:
   - Select Files tab - File tree with checkbox selection
   - Instructions tab - Custom prompt builder with template support  
   - Generate Prompt tab - Final prompt generation with token counting
   - Apply & Review tab - AI response parsing and code diff visualization

3. **File Selection** (`src/fileExplorer.ts`) - Custom tree view provider that respects .gitignore and custom ignore patterns

4. **Prompt Generation** (`src/promptGenerator.ts`) - Generates structured prompts with XML-like tags for file contents and instructions

5. **Token Counting** (`src/tokenCounter.ts`) - Uses GPT tokenizer with caching for real-time token counts

### Build System
- Uses esbuild for fast bundling
- Separate builds for extension code (Node.js) and webview code (browser IIFE)
- CSS files are copied directly during build
- Source maps in dev, minified in production

### Key Design Patterns
- The webview communicates with the extension via message passing
- File selection state is managed in the extension and synced to webview
- Templates are loaded from both built-in locations and workspace `.promptcode/prompts` directory
- Token counting is cached for performance

### CSS Organization
Per the Cursor rules in `.cursor/rules/css-rules.md`:
- All CSS must be in separate `.css` files under `src/webview/styles/`
- No inline styles in JavaScript/TypeScript files
- CSS is organized by component (buttons.css, layout.css, tabs.css, etc.)
- All CSS imports go through `index.css`

---

## Using Gemini CLI for Large Codebase Analysis

When analyzing large codebases or multiple files that might exceed context limits, use the Gemini CLI with its massive context window. Use `gemini -p` to leverage Google Gemini's large context capacity.

### File and Directory Inclusion Syntax

Use the `@` syntax to include files and directories in your Gemini prompts. The paths should be relative to WHERE you run the gemini command:

#### Examples:

**Single file analysis:**
```bash
gemini -p "@src/main.py Explain this file's purpose and structure"
```

**Multiple files:**
```bash
gemini -p "@package.json @src/index.js Analyze the dependencies used in the code"
```

**Entire directory:**
```bash
gemini -p "@src/ Summarize the architecture of this codebase"
```

**Multiple directories:**
```bash
gemini -p "@src/ @tests/ Analyze test coverage for the source code"
```

**Current directory and subdirectories:**
```bash
gemini -p "@./ Give me an overview of this entire project"
```

**Or use --all_files flag:**
```bash
gemini --all_files -p "Analyze the project structure and dependencies"
```

### Implementation Verification Examples

**Check if a feature is implemented:**
```bash
gemini -p "@src/ @lib/ Has dark mode been implemented in this codebase? Show me the relevant files and functions"
```

**Verify authentication implementation:**
```bash
gemini -p "@src/ @middleware/ Is JWT authentication implemented? List all auth-related endpoints and middleware"
```

**Check for specific patterns:**
```bash
gemini -p "@src/ Are there any React hooks that handle WebSocket connections? List them with file paths"
```

**Verify error handling:**
```bash
gemini -p "@src/ @api/ Is proper error handling implemented for all API endpoints? Show examples of try-catch blocks"
```

**Check for rate limiting:**
```bash
gemini -p "@backend/ @middleware/ Is rate limiting implemented for the API? Show the implementation details"
```

**Verify caching strategy:**
```bash
gemini -p "@src/ @lib/ @services/ Is Redis caching implemented? List all cache-related functions and their usage"
```

**Check for specific security measures:**
```bash
gemini -p "@src/ @api/ Are SQL injection protections implemented? Show how user inputs are sanitized"
```

**Verify test coverage for features:**
```bash
gemini -p "@src/payment/ @tests/ Is the payment processing module fully tested? List all test cases"
```

### When to Use Gemini CLI

Use `gemini -p` when:
- Analyzing entire codebases or large directories
- Comparing multiple large files
- Need to understand project-wide patterns or architecture
- Current context window is insufficient for the task
- Working with files totaling more than 100KB
- Verifying if specific features, patterns, or security measures are implemented
- Checking for the presence of certain coding patterns across the entire codebase

### Important Notes

- Paths in `@` syntax are relative to your current working directory when invoking gemini
- The CLI will include file contents directly in the context
- No need for `--yolo` flag for read-only analysis
- Gemini's context window can handle entire codebases that would overflow Claude's context
- When checking implementations, be specific about what you're looking for to get accurate results
- When looking online, I remind you that we are in 2025, so for latest information, make sure you don't check old information or documentation.
- Make sure you are **thorough** - for example, if you install a new package, make sure our requirements.txt or package.json is updated.
