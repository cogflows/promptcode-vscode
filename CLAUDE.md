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

### Overview
We use the "Node.js way" - build everything on tag push, promote selectively:
- Version numbers are cheap - increment freely if issues found
- Never force-push tags - each release is immutable
- Control user updates via GitHub's "latest" flag and marketplace publishing

### GitHub Actions Workflow
1. **Create and push tag**: `git tag v0.7.0 && git push origin v0.7.0`
2. **Automatic build**: GitHub Actions builds all artifacts with `make_latest: false`
3. **Test artifacts**: Download and verify from GitHub Release
4. **Promote when ready**:
   - CLI only: `gh workflow run promote-cli.yml -f tag=v0.7.0`
   - Extension only: `gh workflow run publish-extension.yml -f tag=v0.7.0`
   - Both: `gh workflow run promote-all.yml -f tag=v0.7.0`

### Quick Commands
```bash
# Standard release (both products)
npm version patch && git push origin main --tags
# After testing: gh workflow run promote-all.yml -f tag=v0.7.0

# Hotfix workflow
# Found bug in v0.7.0? Just increment:
npm version patch  # Creates v0.7.1
git push origin main --tags
# Test and promote v0.7.1 instead
```

### Manual Builds (Development)
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
# PromptCode CLI

AI-ready code analysis via presets and expert consultations.

## Commands
- `/promptcode-preset-list` - List available presets
- `/promptcode-preset-info <name>` - Show preset details & tokens
- `/promptcode-preset-create <description>` - Create preset from description
- `/promptcode-preset-to-prompt <preset> [-- instructions]` - Export preset to file with optional instructions
- `/promptcode-ask-expert <question>` - AI consultation with code context

## Workflow Examples

### Discovery → Context → Expert
```bash
/promptcode-preset-list                    # Find existing presets
/promptcode-preset-create auth system      # Or create focused preset
/promptcode-preset-to-prompt auth -- Review for security issues  # Export with instructions
/promptcode-ask-expert Why is login slow?  # Consult with context
```

### Direct CLI Usage

```bash
promptcode expert "Review this" --preset api --yes   # After cost approval
promptcode generate -f "src/**/*.ts" -o prompt.txt   # Export for external use
```

## Cost Approval Protocol

1. CLI estimates cost (threshold: $0.50)
2. CC asks user ONCE for approval
3. CC re-runs with `--yes` flag

## API Keys Required

```bash
export OPENAI_API_KEY=sk-...     # GPT/O3 models
export ANTHROPIC_API_KEY=sk-...  # Claude models
export GOOGLE_API_KEY=...        # Gemini models
export XAI_API_KEY=...           # Grok models
```

💡 **Tip**: Create focused presets for better context and lower costs.
<!-- PROMPTCODE-CLI-END -->

## CRITICAL: Claude Command Templates

⚠️ **IMPORTANT**: The `.claude/commands/*.md` files in this project are **OVERWRITTEN** when users run `promptcode cc` (Claude Code integration)!

### Where to Make Changes:
- ❌ **NEVER** edit `.claude/commands/*.md` directly - changes will be lost
- ✅ **ALWAYS** edit the source templates in `packages/cli/src/claude-templates/*.md`
- ✅ After editing source templates, rebuild the CLI: `cd packages/cli && bun run build`

### Template Locations:
```
packages/cli/
├── src/claude-templates/        # SOURCE templates - EDIT THESE
│   ├── promptcode-ask-expert.md
│   ├── promptcode-preset-*.md
│   └── ...
└── dist/claude-templates/       # Built templates - auto-generated, don't edit
```

### Workflow for Command Changes:
1. Edit files in `packages/cli/src/claude-templates/`
2. Build CLI: `cd packages/cli && bun run build`
3. **IMPORTANT**: Build process auto-preserves old checksums in `previous-checksums.json`
4. Commit both the template changes AND the updated checksums
5. Create new release with version bump
6. Users get updated commands via `promptcode update` → `promptcode cc`

### Critical: Template Checksums
- **Why checksums matter**: CC uses checksums to distinguish "known old versions" from "user modifications"
- **Without old checksums**: CC thinks old templates have "local changes" and skips updates
- **Auto-preservation**: Build process now automatically preserves old checksums
- **Always commit**: Include `scripts/previous-checksums.json` changes in your commits