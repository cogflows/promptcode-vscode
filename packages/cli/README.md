# PromptCode CLI

Command-line interface for PromptCode - generate AI-ready prompts from your codebase with preset management and AI expert consultation.

## Installation

### Quick Install

```bash
# Install from GitHub releases
curl -fsSL https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.sh | bash
```

The installation script will:
- Download the latest prebuilt binary for your platform
- Make it executable and add to your PATH (~/.local/bin)
- Create a global `promptcode` command
- Set up auto-update functionality

### Manual Installation

```bash
# Install Bun first (if not installed)
curl -fsSL https://bun.sh/install | bash

# Then build the CLI
cd packages/cli
bun install
bun run build
bun link
```

### Via NPM (Coming Soon)

```bash
npm install -g promptcode-cli
```

## Quick Start

### Expert Mode

```bash
# Ask questions without code context (pure AI consultation)
promptcode expert "What are the best practices for API design?"
promptcode expert "How does OAuth2 work?"

# Ask questions with codebase context using AI experts
promptcode expert "Why is this API slow?" -f src/**/*.ts
promptcode expert "Explain the auth flow" -f backend/**/*.ts
promptcode expert "What are the security risks?" --preset api
```

### Generate Mode

```bash
# Generate prompts from files for AI analysis
promptcode generate -f src/**/*.ts docs/**/*.md

# Create and use presets for reusable patterns
promptcode preset create backend
promptcode generate -p backend -o prompt.md

# Ask AI expert for help (requires API key)
export OPENAI_API_KEY=sk-...
promptcode expert "How can I optimize this API?" -p backend
```

## Core Commands

### Generate

Generate AI-ready prompts from your codebase:

```bash
promptcode generate                      # All files
promptcode generate -f "src/**/*.ts"     # Specific patterns
promptcode generate -p backend           # Use preset
promptcode generate -t code-review       # Apply template
```

### Preset Management

Create and manage file pattern presets with automatic optimization:

```bash
# Basic commands
promptcode preset list                         # List all presets
promptcode preset create backend               # Create basic preset
promptcode preset info backend                 # Show preset details
promptcode preset edit backend                 # Edit in your editor
promptcode preset delete backend               # Delete preset

# Smart preset creation with auto-optimization
promptcode preset create api --from-files "src/api/**/*.ts"  # Auto-optimized (balanced)
promptcode preset create api --from-files "src/api/**/*.ts" --optimization-level aggressive

# Optimize existing presets
promptcode preset optimize backend             # Preview changes (dry-run)
promptcode preset optimize backend --write     # Apply optimization

# Search presets
promptcode preset search "auth"                # Find presets by content
```

**Optimization levels:**
- `minimal` - Full directory coverage only (backwards-compatible)
- `balanced` - Extension grouping + single-file exclusions (default)
- `aggressive` - Maximum compression with brace notation

### Expert Consultation

Ask questions with full codebase context:

```bash
# Set up OpenAI API key first
export OPENAI_API_KEY=sk-...

# Ask questions
promptcode expert "Explain the auth flow" --preset auth
promptcode expert "Find security issues" -f "src/api/**/*.ts"
promptcode expert "Review this code" --background  # Force OpenAI background mode
```

### AI Agent Integrations

**Claude Code Integration** - Set up integration with Claude Code:

```bash
# Basic usage
promptcode cc                             # Install commands only
promptcode cc --with-docs                 # Install commands + CLAUDE.md

# Manage documentation separately
promptcode cc docs update                 # Update CLAUDE.md
promptcode cc docs diff                   # Show what would change
promptcode cc docs check                  # Check if up-to-date (CI-friendly)

# Uninstall
promptcode cc uninstall                   # Remove commands only
promptcode cc uninstall --all             # Remove commands + CLAUDE.md
```

This creates a `.claude/` folder with custom commands that appear in Claude Code as slash commands like `/promptcode-preset-list`. The CLAUDE.md documentation is now optional and can be managed separately.

**Cursor Integration** - Set up integration with Cursor IDE/CLI:

```bash
promptcode cursor                         # Set up Cursor integration
promptcode cursor --uninstall             # Remove Cursor integration
```

This creates `.cursor/rules/*.mdc` files that teach Cursor's AI agent about PromptCode. Supports pseudo-commands like `/promptcode-preset-list` and `/promptcode-preset-info` (matching Claude Code's command naming).

### Other Commands

**Stats** - Analyze token usage:

```bash
promptcode stats                         # Whole project
promptcode stats -l backend              # Specific preset
promptcode stats --json                  # Output as JSON
```

The stats command uses a high-performance two-phase approach:
- **Discovery phase**: Quickly counts files without reading content
- **Processing phase**: Reads files with optimized concurrency and progress tracking
- Automatically skips symlinks and common large directories (node_modules, .git, etc.)
- Shows real-time progress with ETA for large projects
- Handles 100k+ files efficiently without hanging

**Cache** - Manage token cache:

```bash
promptcode cache clear                   # Clear cache
promptcode cache stats                   # Show cache statistics
```

## Presets

Presets are stored in `.promptcode/presets/` and use gitignore syntax:

```bash
# backend.patterns
# Include all TypeScript files
**/*.ts
**/*.tsx

# Include config files
package.json
tsconfig.json

# Exclude test files
!**/*.test.ts
!**/*.spec.ts
!**/node_modules/**
```

## Templates

Built-in templates:

- `code-review` - Code review checklist
- `optimize` - Performance optimization
- `refactor` - Refactoring suggestions

Custom templates go in `~/.config/promptcode/prompts/`.

## Configuration

API keys must be set via environment variables (first match wins):

- **OpenAI**: `OPENAI_API_KEY`, `OPENAI_KEY`
- **Anthropic**: `ANTHROPIC_API_KEY`, `CLAUDE_API_KEY`
- **Google**: `GOOGLE_API_KEY`, `GOOGLE_CLOUD_API_KEY`, `GOOGLE_AI_API_KEY`, `GEMINI_API_KEY`
- **xAI**: `XAI_API_KEY`, `GROK_API_KEY`
- `XDG_CONFIG_HOME` - Config directory (defaults to ~/.config)
- `XDG_CACHE_HOME` - Cache directory (defaults to ~/.cache)
- `DEBUG='promptcode:*'` - Enable debug logging
- `PROMPTCODE_TOKEN_WARNING` - Token threshold for warnings (default: 50000)
- `PROMPTCODE_FORCE_BACKGROUND=1` - Always route OpenAI models through background mode
- `PROMPTCODE_DISABLE_BACKGROUND=1` - Disable background mode even for GPT-5 Pro
- `PROMPTCODE_FALLBACK_BACKGROUND=1` - Automatically retry foreground timeouts using OpenAI background mode
- `PROMPTCODE_TIMEOUT_MS`, `PROMPTCODE_TIMEOUT_<MODEL>_MS`, `PROMPTCODE_TIMEOUT_CAP_MS` - Override foreground timeout behaviour (milliseconds)

## Examples

### API Performance Analysis

```bash
# Create a preset for API endpoints
promptcode preset create api-endpoints
# Edit .promptcode/presets/api-endpoints.patterns to include:
# src/api/**/*.ts
# src/middleware/**/*.ts
# !**/*.test.ts

# Analyze performance issues
promptcode expert "Why are our API endpoints slow?" --preset api-endpoints

# Generate detailed context for manual analysis
promptcode generate --preset api-endpoints --instructions "Focus on database queries and N+1 problems"
```

### Security Audit

```bash
# Quick security check of authentication code
promptcode expert "Find security vulnerabilities in our auth system" \
  -f "src/auth/**/*.ts" "src/middleware/auth.ts"

# Comprehensive security review with context
promptcode generate \
  -f "src/api/**/*.ts" "src/auth/**/*.ts" "src/middleware/**/*.ts" \
  --template security-review \
  --output security-audit.md
```

### Documentation Generation

```bash
# Generate API documentation from code
promptcode expert "Create OpenAPI documentation for these endpoints" \
  -f "src/api/routes/*.ts" \
  --output api-docs.yaml

# Generate README for a specific module
promptcode expert "Write comprehensive documentation for this module" \
  -f "src/modules/payment/**/*.ts" \
  --output modules/payment/README.md
```

### Migration Planning

```bash
# Analyze code before framework migration
promptcode preset create legacy-code
promptcode expert "What needs to be refactored for React 18 migration?" \
  --preset legacy-code \
  --model gpt-5

# Get specific migration steps
promptcode generate --preset legacy-code \
  --instructions "Create step-by-step migration plan from Express to Fastify"
```

### Code Review Workflow

```bash
# Create preset for feature
promptcode preset --create feature-auth

# Generate context for review
promptcode generate -p feature-auth -t code-review -o review.md

# Get AI review
promptcode expert "Review this auth implementation" -p feature-auth
```

### Debugging Workflow

```bash
# Analyze specific files
promptcode generate -f "src/api/*.ts" "logs/*.log" -o debug-context.md

# Ask for help
promptcode expert "Why is the API returning 500 errors?" -f "src/api/*.ts"
```

### Refactoring Workflow

```bash
# Create preset for refactoring target
promptcode preset create old-components

# Get AI-powered refactoring suggestions
promptcode expert "How should I refactor these components for better performance?" \
  --preset old-components \
  --model sonnet-4

# Generate refactoring prompt for external AI tools
promptcode generate -p old-components -t refactor | your-ai-tool

# Review and apply suggestions using your IDE or VCS
```

### Test Coverage Analysis

```bash
# Identify untested code
promptcode expert "What critical paths lack test coverage?" \
  -f "src/**/*.ts" "!src/**/*.test.ts" \
  --instructions "Compare implementation files with test files"

# Generate test cases
promptcode expert "Generate comprehensive test cases for this module" \
  -f "src/services/payment.ts" \
  --output tests/payment.test.ts
```

### Architecture Review

```bash
# Analyze current architecture
promptcode generate \
  -f "src/**/*.ts" "package.json" "tsconfig.json" \
  --instructions "Analyze architecture and identify anti-patterns" \
  --output architecture-review.md

# Get improvement suggestions
promptcode expert "How can we improve our microservices architecture?" \
  --preset backend \
  --model gpt-5
```

### Quick Fixes

```bash
# Fix a specific error
promptcode expert "How do I fix this TypeScript error?" \
  -f "src/components/UserProfile.tsx" \
  --instructions "Error: Property 'id' does not exist on type 'User'"

# Optimize a slow function
promptcode expert "Optimize this function for better performance" \
  -f "src/utils/dataProcessor.ts"
```

## Cost Threshold

By default, operations estimated above **$0.50** require approval. Configure via:

- CLI: `--cost-threshold <usd>`
- Env: `PROMPTCODE_COST_THRESHOLD=<usd>`

Use `--yes` or `--force` (alias) to bypass confirmation **only after user approval**.

## Exit Codes

The CLI uses standardized exit codes for programmatic usage:

| Code | Name | Description |
|------|------|-------------|
| 0 | SUCCESS | Operation completed successfully |
| 1 | GENERAL_ERROR | General error |
| 2 | APPROVAL_REQUIRED | Cost approval needed (non-interactive mode) |
| 3 | INVALID_INPUT | Invalid command or arguments |
| 4 | MISSING_API_KEY | API key not configured |
| 5 | CONTEXT_TOO_LARGE | Context exceeds model limits |
| 6 | FILE_NOT_FOUND | File or preset not found |
| 7 | OPERATION_CANCELLED | User cancelled operation |
| 8 | NETWORK_ERROR | Network or API error |
| 9 | PERMISSION_DENIED | Permission denied for file operations |

## Tips

1. **Use presets** for different parts of your codebase
2. **Check token counts** with `stats` before generating (fast even for large repos)
3. **Stream responses** for long expert consultations
4. **Save outputs** to `.promptcode/outputs/` for reference
5. **Clear cache** occasionally to ensure accurate token counts

## Troubleshooting

- **Command not found**: Ensure `~/.local/bin` is in your PATH
- **Token counts wrong**: Clear cache with `promptcode cache clear`
- **API errors**: Check your API keys are set in environment variables
