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
