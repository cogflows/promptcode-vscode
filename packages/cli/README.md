# PromptCode CLI

Command-line interface for PromptCode - generate AI-ready prompts from your codebase with preset management and AI expert consultation.

## Installation

### Quick Install (Bun-based)
```bash
# Clone the repo or navigate to the CLI package
cd packages/cli

# Run the installation script (installs Bun if needed)
./install.sh
```

The installation script will:
- Install Bun if not already installed
- Install all dependencies
- Build the CLI
- Create a global `promptcode` command

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

### AI-Agent Friendly (Zero Configuration)
```bash
# Ask questions with codebase context
promptcode "Why is this API slow?" src/**/*.ts
promptcode "Explain the auth flow" @backend/ @frontend/
promptcode "What are the security risks?"  # Analyzes entire project

# Generate prompts from files
promptcode src/**/*.ts docs/**/*.md  # Just files = generate mode
```

### Traditional Workflow
```bash
# Create a preset for your backend code
promptcode preset --create backend

# Generate a prompt using the preset
promptcode generate -p backend -o prompt.md

# Ask AI expert for help (requires API key)
promptcode config --set-openai-key sk-...
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
Create and manage file pattern presets:
```bash
promptcode preset --list                 # List all presets
promptcode preset --create api-routes    # Create new preset
promptcode preset --info api-routes      # Show preset details
promptcode preset --edit api-routes      # Edit in your editor
promptcode preset --delete api-routes    # Delete preset
```

### Expert Consultation
Ask questions with full codebase context:
```bash
# Set up OpenAI API key first
promptcode config --set-openai-key sk-...

# Ask questions
promptcode expert "Explain the auth flow" --preset auth
promptcode expert "Find security issues" -f "src/api/**/*.ts"
promptcode expert "Review this code" --stream  # Real-time response
```

### Other Commands

**Stats** - Analyze token usage:
```bash
promptcode stats                         # Whole project
promptcode stats -p backend              # Specific preset
```

**Diff** - Apply AI-generated changes:
```bash
promptcode diff response.md --preview    # Preview changes
promptcode diff response.md --apply      # Apply changes
```

**Extract** - Extract code from AI responses:
```bash
promptcode extract response.md           # List code blocks
promptcode extract response.md --save-dir ./generated
```

**Validate** - Check generated code:
```bash
promptcode validate generated.ts         # Check for issues
promptcode validate response.md --fix    # Auto-fix
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

Configuration is stored in `~/.config/promptcode/config.json`:

```bash
promptcode config --show                 # View config
promptcode config --set-openai-key KEY   # Set API key
promptcode config --reset                # Reset all
```

Environment variables:
- `OPENAI_API_KEY` - OpenAI API key (overrides config)
- `XDG_CONFIG_HOME` - Config directory
- `XDG_CACHE_HOME` - Cache directory

## Examples

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
promptcode preset --create old-components

# Get suggestions
promptcode generate -p old-components -t refactor | your-ai-tool

# Apply changes
promptcode diff suggestions.md --preview
promptcode diff suggestions.md --apply
```

## Tips

1. **Use presets** for different parts of your codebase
2. **Check token counts** with `stats` before generating
3. **Always preview** before applying diffs
4. **Stream responses** for long expert consultations
5. **Save outputs** to `.promptcode/outputs/` for reference

## Troubleshooting

- **Command not found**: Ensure `~/.local/bin` is in your PATH
- **Token counts wrong**: Clear cache with `promptcode cache clear`
- **API errors**: Check your OpenAI API key with `promptcode config --show`