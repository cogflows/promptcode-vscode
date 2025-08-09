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
## Notes for Claude Code

After recent changes:
- Environment checks are centralized in `packages/cli/src/utils/environment.ts`
- Use helper functions like `isInteractive()`, `shouldShowSpinner()`, `shouldSkipConfirmation()`
- Debug logging uses the `debug` npm package with namespace `promptcode:*`
- All tests pass - run with `cd packages/cli && bun test`
- To release: Create a tag and push to trigger GitHub Actions
- DO NOT make shortcuts, always use the most idiomatic and generic solution

<!-- PROMPTCODE-CLI-START -->
# PromptCode CLI

Generate AI-ready prompts from your codebase. The CLI is designed to be AI-friendly with clear commands and outputs.

## Quick Start

```bash
# Generate a prompt with specific files
promptcode generate src/api/handler.ts src/utils/*.ts

# Ask AI experts questions with code context
promptcode expert "Why is this slow?" src/api/handler.ts

# Web search is enabled by default for supported models (O3, Gemini, Claude, Grok)
promptcode expert "What are the latest React 19 features?" src/components/*.tsx

# Explicitly disable web search if needed
promptcode expert "Review this code" src/api/*.ts --no-web-search

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

## Web Search Support

The expert command now includes built-in web search capabilities for supported models:

**Models with Web Search:**
- **OpenAI**: O3, O3 Pro, O3 Mini - Uses web_search_preview tool
- **Google**: Gemini 2.5 Pro/Flash - Uses Google Search grounding
- **Anthropic**: Claude Opus 4, Sonnet 4 - Uses web_search tool
- **xAI**: Grok 4 - Has built-in real-time web access

**Usage:**
```bash
# Web search is enabled by default for supported models
promptcode expert "What are the breaking changes in TypeScript 5.8?"

# Explicitly enable web search
promptcode expert "Latest best practices for React Server Components" --web-search

# Disable web search when you don't need current information
promptcode expert "Review this code for bugs" src/**/*.ts --no-web-search
```

**Benefits:**
- Access to current documentation and recent updates
- Real-time information for rapidly evolving technologies
- Grounded responses with source citations
- Better accuracy for questions about recent events or releases

## Tips for AI Agents

1. **Always check token counts** - Use `promptcode preset info` to see total tokens before generating
2. **Be specific with patterns** - Use `src/api/*.ts` not `**/*.ts` to avoid huge contexts
3. **Leverage existing presets** - Check `promptcode preset list` before creating new ones
4. **Use descriptive preset names** - `auth-system` not `preset1`
5. **Use web search for current info** - Enabled by default for questions about latest features, docs, or best practices

## Important: Cost Approval for AI Agents

The `expert` command includes built-in cost protection that requires approval for expensive operations (over $0.50 or using premium models). The CLI will automatically handle this in different environments:

**In Interactive Mode (Terminal):**
- The CLI will prompt the user directly for approval
- Shows cost breakdown and waits for yes/no response

**In Non-Interactive Mode (Claude Code, CI/CD):**
```bash
# Without approval flags, expensive operations will be blocked:
promptcode expert "Complex analysis" --model o3-pro
# Output: "⚠️ Cost approval required for expensive operation (~$X.XX)"
#         "Non-interactive environment detected."
#         "Use --yes to proceed with approval..."
```

**AI Agent Approval Protocol:**
1. **When you see "Cost approval required"**, STOP immediately
2. **Inform the user**: "This operation will cost approximately $X.XX. Do you want to proceed?"
3. **Wait for explicit user confirmation** (yes/no)
4. **If approved**, re-run the command with `--yes` flag:
   ```bash
   promptcode expert "Complex analysis" --model o3-pro --yes
   ```
5. **If declined**, inform the user the operation was cancelled

**Important Guidelines for AI Agents:**
- **NEVER** automatically add `--yes` without explicit user consent
- **ALWAYS** show the cost estimate before asking for approval
- The `--yes` flag means "I have user approval for this specific operation"
- The `--yes` flag can be used to auto-approve operations after user consent
- Default to conservative behavior - when in doubt, ask for approval

**Cost Information:**
- Expensive models: o3-pro
- Threshold: Operations over $0.50 require approval
- The CLI shows detailed cost breakdowns before execution

## Configuration

API keys can be set via environment variables or config:
```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=...
export GROK_API_KEY=xai-...

# Or use config command
export OPENAI_API_KEY=sk-...
```

<details>
<summary>⚠️ Troubleshooting</summary>

• **Command not found** – The CLI auto-installs to `~/.local/bin`. Ensure it's in PATH  
• **Missing API key** – Set via environment variable as shown above  
• **Context too large** – Use more specific file patterns or create focused presets
• **Preset not found** – Check `.promptcode/presets/` directory exists
</details>
<!-- PROMPTCODE-CLI-END -->