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

### 3. Apply AI Changes
```bash
# After generating code, preview changes
promptcode diff ai-response.md --preview

# Apply the changes
promptcode diff ai-response.md --apply
```

### 4. Extract Code from Responses
```bash
# List code blocks in response
promptcode extract conversation.md

# Save specific language code
promptcode extract response.md --lang typescript --save-dir ./generated
```

### 5. Validate Generated Code
```bash
# Check for common issues
promptcode validate generated-code.ts

# Auto-fix issues
promptcode validate response.md --fix
```

## Command Cheat Sheet

| Command | Purpose | Key Options |
|---------|---------|-------------|
| `generate` | Create AI prompts | `-f` patterns, `-t` template, `--json` |
| `context add` | Add files to context | Glob patterns supported |
| `context list` | Show current context | - |
| `context save` | Save named context | `--save <name>` |
| `diff` | Compare/apply changes | `--preview`, `--apply` |
| `extract` | Get code from responses | `--lang`, `--save-dir` |
| `validate` | Check code quality | `--fix`, `--rules` |
| `watch` | Monitor file changes | `-o` output, `--debounce` |
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
# AI generates fixes in response.md
promptcode extract response.md --save-dir ./fixes
promptcode diff response.md --preview
promptcode diff response.md --apply
```

## Tips

1. Use `context` commands to maintain state across AI conversations
2. Always `--preview` before `--apply` when using diff
3. Use `--json` output for programmatic processing
4. Create custom templates in `~/.config/promptcode/prompts/`
5. Use `stats` to check if context fits in token limits

## Getting Help

```bash
promptcode --help              # General help
promptcode <command> --help    # Command-specific help
promptcode templates           # List available templates
```