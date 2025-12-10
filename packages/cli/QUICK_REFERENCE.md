# PromptCode CLI - Quick Reference for AI Agents

## Overview
PromptCode CLI helps AI coding assistants work with codebases by generating structured prompts, managing file contexts, and processing AI-generated code.

## Core Workflow for AI Agents

### 1. Initial Context Setup
```bash
# Generate a prompt from specific files
promptcode generate -f "src/**/*.ts" -o initial-context.md

# Or add files to persistent context
promptcode context add "src/**/*.ts" "package.json" "README.md"
promptcode context save --save "current-task"
```

### 2. Generate Prompts
```bash
# Basic generation (outputs to stdout)
promptcode generate

# With specific patterns
promptcode generate -f "src/**/*.{ts,tsx}" "!**/*.test.ts"

# Using templates
promptcode generate -t code-review

# Get JSON with metadata
promptcode generate --json -o prompt.json
```

### 3. Working with AI Responses
```bash
# After generating code:
# - Use your IDE's diff tools to review changes
# - Ask your AI tool to save code blocks directly to files
# - Use your project's linter and test suite to validate code
```

## Command Cheat Sheet

| Command | Purpose | Key Options |
|---------|---------|-------------|
| `generate` | Create AI prompts | `-f` patterns, `-t` template, `--json` |
| `preset` | Manage file presets | `--create`, `--list`, `--info` |
| `expert` | Ask AI expert | `--model`, `--background`, `--preset`, `--images`, `--allow-images` |
| `cache` | Manage token cache | `clear`, `stats` |
| `stats` | Project token info | Shows breakdown by file type |

## File Patterns

- `**/*.ts` - All TypeScript files
- `src/**/*.{ts,tsx}` - TS/TSX in src
- `!**/*.test.ts` - Exclude test files
- `*.json` - JSON files in root

## Default Locations

- Cache: `~/.cache/promptcode/`
- Config: `~/.config/promptcode/`
- Templates: `~/.config/promptcode/prompts/`
- Project context: `.promptcode/context.json`
- Ignore file: `.promptcode_ignore`

## Examples for Common Tasks

### Code Review
```bash
promptcode generate -f "src/**/*.ts" -t code-review | ai-tool
```

### Refactoring
```bash
promptcode context add "src/components/**/*.tsx"
promptcode generate -i refactor-instructions.md
```

### Debugging
```bash
promptcode generate -f "src/api/*.ts" "src/utils/logger.ts" -o debug-context.md
```

### Applying Fixes
```bash
# Ask AI to generate fixes with specific file patterns
promptcode expert "Fix the authentication issues" -f "src/auth/**/*.ts"
# Review changes in your IDE and apply using version control
```

## Tips

1. Use presets to maintain consistent file patterns
2. Use `--json` output for programmatic processing
3. Create custom templates in `~/.config/promptcode/prompts/`
4. Use `stats` to check if context fits in token limits
5. Clear cache with `cache clear` if token counts seem incorrect
6. Vision only when needed: attach images with `--images`/`--allow-images` on vision models (gpt-5.1, sonnet-4.5, gemini-3-pro, grok-4); image size is capped by the model limit even if `--image-max-mb` is higher; image costs are not estimated (`imageCostEstimated:false` in JSON)

## Getting Help

```bash
promptcode --help              # General help
promptcode <command> --help    # Command-specific help
promptcode templates           # List available templates
```
