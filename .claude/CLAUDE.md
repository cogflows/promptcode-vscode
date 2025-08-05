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