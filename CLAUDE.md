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