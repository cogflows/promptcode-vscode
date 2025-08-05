# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptCode is a VS Code extension that bridges codebases with AI models. It helps developers generate structured prompts by selecting specific files and adding custom instructions, working with any AI model including non-API ones like o1-pro or Grok.

## Common Development Commands

### Extension Build Commands
- `npm run compile` - Development build with source maps
- `npm run build:prod` - Production build with minification, no source maps
- `npm run watch` - Watch mode for auto-rebuilds during development

### CLI Build Commands (uses Bun)
- `cd packages/cli && bun install` - Install CLI dependencies
- `cd packages/cli && bun run build` - Compile CLI to standalone binary
- `cd packages/cli && bun run dev` - Run CLI in development mode
- Note: The CLI is built with Bun for fast compilation and distribution

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

<!-- PROMPTCODE-CLI-START -->
# PromptCode CLI

Generate AI-ready prompts from your codebase. The CLI is designed to be AI-friendly with clear commands and outputs.

## Quick Start

```bash
# Generate a prompt with specific files
promptcode generate src/api/handler.ts src/utils/*.ts

# Ask AI experts questions with code context
promptcode expert "Why is this slow?" src/api/handler.ts

# Use presets for common file patterns
promptcode preset list                    # See available presets
promptcode preset info <name>             # Show preset details & token count
promptcode generate -l <preset-name>      # Generate using preset
```

## Working with Presets

Presets are reusable file patterns stored in `.promptcode/presets/*.patterns`:

```bash
# Create a new preset
promptcode preset create api-endpoints

# Edit the preset file to add patterns
# Then use it:
promptcode generate -l api-endpoints
```

## Common Workflows for AI Agents

### 1. Discovering Code Structure
```bash
# List all presets to understand project organization
promptcode preset list

# Inspect a preset to see what files it includes
promptcode preset info functional-utils
```

### 2. Creating Focused Presets
When asked to analyze specific features:
1. Create a descriptive preset: `promptcode preset create feature-name`
2. Edit `.promptcode/presets/feature-name.patterns` with relevant patterns
3. Use `promptcode preset info feature-name` to verify file selection
4. Generate output: `promptcode generate -l feature-name`

### 3. Analyzing Code
```bash
# Generate prompt with specific concern
promptcode generate src/**/*.ts --instructions "Find performance bottlenecks"

# Or use expert mode for direct AI analysis
promptcode expert "Review this code for security issues" src/api/**/*.ts
```

## Tips for AI Agents

1. **Always check token counts** - Use `promptcode preset info` to see total tokens before generating
2. **Be specific with patterns** - Use `src/api/*.ts` not `**/*.ts` to avoid huge contexts
3. **Leverage existing presets** - Check `promptcode preset list` before creating new ones
4. **Use descriptive preset names** - `auth-system` not `preset1`

## Important: Cost Approval for AI Agents

When using the `expert` command with expensive models, the CLI will request approval for costs over $0.50:

```bash
# This will show: "Non-interactive environment detected. Use --no-confirm or --yes"
promptcode expert "Complex analysis" --model o3-pro

# AI agents should handle this by:
# 1. Informing the user about the cost
# 2. Asking for explicit approval
# 3. Only then running with --yes flag
```

**AI Agent Approval Protocol:**
1. When you see "Non-interactive environment detected", STOP
2. Tell the user: "This will cost approximately $X.XX. Do you want to proceed?"
3. Wait for user confirmation (yes/no)
4. If approved, re-run the command with `--yes` flag
5. If declined, inform the user the operation was cancelled

**Never automatically add --yes without user consent for expensive operations!**

## Configuration

API keys can be set via environment variables or config:
```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=...
export GROK_API_KEY=xai-...

# Or use config command
promptcode config --set-openai-key sk-...
```

<details>
<summary>⚠️ Troubleshooting</summary>

• **Command not found** – The CLI auto-installs to `~/.local/bin`. Ensure it's in PATH  
• **Missing API key** – Set via environment variable or `promptcode config`  
• **Context too large** – Use more specific file patterns or create focused presets
• **Preset not found** – Check `.promptcode/presets/` directory exists
</details>
<!-- PROMPTCODE-CLI-END -->