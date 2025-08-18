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
- **Prompt Generation**: `packages/core/src/promptBuilder.ts` - Builds structured prompts from selected files and instructions
- **Token Counting**: `src/tokenCounter.ts` - Uses GPT tokenizer with caching for real-time token counts

### CLI Tool
- **Entry Point**: `packages/cli/src/index.ts`
- **Commands**: generate, expert, preset, stats
  > Note: `diff`, `watch`, `validate`, and `extract` were removed in v0.3.x.
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
- **We are in 2025**, when using web search, you should use the most recent information (don't state 2024)

<!-- PROMPTCODE-CLI-START -->
# PromptCode CLI Integration

This project has PromptCode CLI integrated for AI-assisted code analysis. The CLI provides structured access to the codebase through presets and intelligent commands.

## Available Claude Commands

The following commands are available to help you work with this codebase:

- `/promptcode-preset-list` - List all available code presets
- `/promptcode-preset-info <name>` - Show details and token count for a preset
- `/promptcode-preset-create <description>` - Create a new preset from description
- `/promptcode-preset-to-prompt <preset>` - Export preset to a file
- `/promptcode-ask-expert <question>` - Consult AI expert with code context

## Quick Examples

```bash
# See what presets are available
/promptcode-preset-list

# Get details about a specific preset
/promptcode-preset-info auth-system

# Create a preset for a feature
/promptcode-preset-create authentication and authorization system

# Ask an expert about the code
/promptcode-ask-expert How does the authentication flow work?
```

## Direct CLI Usage

For simple operations, you can also use the CLI directly:

```bash
# Generate a prompt from files
promptcode generate -f "src/**/*.ts" -o analysis.txt

# Quick expert consultation (requires API key)
promptcode expert "Find security issues" --preset api --yes

# View preset information with JSON output
promptcode preset info backend --json
```

## Configuration

Set API keys via environment variables for expert consultations:
```bash
export OPENAI_API_KEY=sk-...      # For O3/O3-pro models
export ANTHROPIC_API_KEY=sk-...   # For Claude models
export GOOGLE_API_KEY=...         # For Gemini models
export XAI_API_KEY=...            # For Grok models
```

## Cost Protection

The expert command has built-in cost protection:
- Operations over $0.50 require explicit approval
- Premium models (e.g., o3-pro) always require confirmation
- Use `--yes` flag only after getting user approval

<details>
<summary>⚠️ Troubleshooting</summary>

• **Command not found** – The CLI auto-installs to `~/.local/bin`. Ensure it's in PATH  
• **Missing API key** – Set environment variables as shown above  
• **Context too large** – Use more specific file patterns or focused presets  
• **Preset not found** – Check `.promptcode/presets/` directory exists
</details>
<!-- PROMPTCODE-CLI-END -->