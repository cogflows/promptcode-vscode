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
# Create a basic preset
promptcode preset create api-endpoints

# Create an optimized preset from existing files
promptcode preset create api-endpoints --from-files "src/api/**/*.ts"

# Optimize an existing preset
promptcode preset optimize api-endpoints           # Preview changes
promptcode preset optimize api-endpoints --write   # Apply changes

# Use the preset
promptcode generate -l api-endpoints
```

### Optimization Levels
When creating or optimizing presets, you can control the optimization level:
- `minimal` - Light optimization, preserves most patterns
- `balanced` - Default, good balance of pattern reduction
- `aggressive` - Maximum reduction, fewer patterns

Example: `promptcode preset create api --from-files "src/**/*.ts" --optimization-level aggressive`

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

## Configuration

API keys must be set via environment variables:
```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GOOGLE_API_KEY=...            # or GEMINI_API_KEY
export XAI_API_KEY=...                # or GROK_API_KEY
```

<details>
<summary>⚠️ Troubleshooting</summary>

• **Command not found** – The CLI auto-installs to `~/.local/bin`. Ensure it's in PATH  
• **Missing API key** – Set via environment variable as shown above  
• **Context too large** – Use more specific file patterns or create focused presets
• **Preset not found** – Check `.promptcode/presets/` directory exists
</details>