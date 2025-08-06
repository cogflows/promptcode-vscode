# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptCode is a monorepo containing a VS Code extension and CLI tool that bridge codebases with AI models. It helps developers generate structured prompts by selecting specific files and adding custom instructions.

## Project Structure

```
promptocode-vscode/
├── src/                    # VS Code extension source
├── packages/
│   ├── core/              # Shared core functionality
│   │   └── src/           # Token counting, file scanning, prompt building
│   └── cli/               # Standalone CLI tool
│       ├── src/           # CLI commands and providers
│       ├── test/          # Test suite
│       └── dist/          # Built CLI binary
├── .github/workflows/     # CI/CD pipelines
└── package.json           # Root package configuration
```

## Common Development Commands

### Extension (from root)
- `npm run compile` - Development build
- `npm run build:prod` - Production build
- `npm run watch` - Watch mode
- `npm run lint` - Run ESLint
- `npm run package` - Create VSIX package

### CLI (from packages/cli)
- `bun install` - Install dependencies
- `bun run build` - Build standalone binary
- `bun run dev` - Run in development
- `bun test` - Run test suite

### Core Package (from packages/core)
- `npm run build` - Compile TypeScript
- `npm run watch` - Watch mode

### Testing
- `npm test` - Run all tests from root
- `cd packages/cli && bun test` - Run CLI tests
- GitHub Actions run on push to main/develop branches

## Architecture

### VS Code Extension
- **Entry Point**: `src/extension.ts` - Handles activation, command registration, and orchestrates all components
- **Webview System**: Multi-tab interface managed by `webviewProvider.ts`:
  - Select Files tab - File tree with checkbox selection
  - Instructions tab - Custom prompt builder with template support  
  - Generate Prompt tab - Final prompt generation with token counting
  - Apply & Review tab - AI response parsing and code diff visualization
- **File Selection**: `src/fileExplorer.ts` - Custom tree view provider that respects .gitignore and custom ignore patterns
- **Prompt Generation**: `src/promptGenerator.ts` - Generates structured prompts with XML-like tags for file contents and instructions
- **Token Counting**: `src/tokenCounter.ts` - Uses GPT tokenizer with caching for real-time token counts

### CLI Tool
- **Entry Point**: `packages/cli/src/index.ts`
- **Commands**: generate, expert, preset, stats, diff, extract
- **AI Providers**: OpenAI, Anthropic, Google, xAI
- **Build System**: Bun for fast compilation to standalone binary

### Core Package
- **Shared Logic**: Token counting, file scanning, prompt building
- **No Dependencies**: Pure TypeScript utilities
- **Used By**: Both extension and CLI

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

## Environment Variables

### API Keys (CLI)
- `OPENAI_API_KEY` - OpenAI models
- `ANTHROPIC_API_KEY` - Claude models
- `GOOGLE_API_KEY` or `GEMINI_API_KEY` - Google models
- `XAI_API_KEY` or `GROK_API_KEY` - Grok models

### Configuration
- `XDG_CONFIG_HOME` - Config directory (default: ~/.config)
- `XDG_CACHE_HOME` - Cache directory (default: ~/.cache)
- `DEBUG='promptcode:*'` - Enable debug logging
- `PROMPTCODE_TEST=1` - Test mode (disables interactive features)
- `PROMPTCODE_TOKEN_WARNING` - Token threshold (default: 50000)

## Release Process

### GitHub Actions Workflow
1. **Push to main** triggers release workflow
2. **Create tag**: `git tag v0.3.3 && git push origin v0.3.3`
3. **Actions automatically**:
   - Build extension VSIX
   - Build CLI binaries (macOS, Linux, Windows)
   - Run tests
   - Create GitHub release with artifacts

### Manual Release
```bash
# Extension
npm run package  # Creates .vsix file

# CLI
cd packages/cli
bun run build    # Creates dist/promptcode binary
```

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

**Important Notes:**
- Never automatically add `--yes` without user consent for expensive operations
- The `--no-confirm` flag is an auto-accept mode that bypasses ALL confirmations
- Users who want automatic approval for all operations can use `--no-confirm`
- AI agents should prefer `--yes` after explicit user approval

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

## Notes for Claude Code

After recent changes:
- Environment checks are centralized in `packages/cli/src/utils/environment.ts`
- Use helper functions like `isInteractive()`, `shouldShowSpinner()`, `shouldSkipConfirmation()`
- Debug logging uses the `debug` npm package with namespace `promptcode:*`
- All tests pass - run with `cd packages/cli && bun test`
- To release: Create a tag and push to trigger GitHub Actions