# PromptCode CLI

Command-line interface for PromptCode - Generate AI-ready prompts from codebases. Perfect for AI coding agents, CI/CD pipelines, and automated code analysis.

## Features

- 🚀 **Fast & Lightweight** - Built with Bun for instant startup
- 🤖 **AI Agent Ready** - Designed for integration with Claude Code, GitHub Copilot CLI, and other AI tools
- 📊 **Token Counting** - Real-time token counts with caching for optimal context window usage
- 🎯 **Smart File Selection** - Glob patterns, .gitignore support, and custom ignore files
- 📝 **Template Support** - Built-in and custom prompt templates
- 🔧 **Multiple Output Formats** - Plain text or JSON with metadata

## Installation

### Global Installation (Recommended)

```bash
# With Bun
bun add -g promptcode-cli

# With npm  
npm install -g promptcode-cli

# With npx (no installation)
npx promptcode-cli generate --help
```

### Local Installation

```bash
# Clone and build
git clone https://github.com/cogflows/promptcode-vscode.git
cd promptcode-vscode/packages/cli
bun install
bun run build

# Run directly
./dist/promptcode --help
```

## Quick Start

### Generate a prompt from your current directory
```bash
promptcode generate
```

### Generate with specific files
```bash
promptcode generate -f "src/**/*.ts" "!**/*.test.ts"
```

### Use a template
```bash
promptcode generate -f "src/**/*.ts" -t code-review
```

### Save output to file
```bash
promptcode generate -o prompt.md
```

### Get JSON output for programmatic use
```bash
promptcode generate --json | jq .tokenCount
```

## Commands

### `generate` - Generate AI prompts

Generate structured prompts from your codebase with full control over file selection and formatting.

```bash
promptcode generate [options]
```

**Options:**
- `-p, --path <dir>` - Project root directory (default: current directory)
- `-f, --files <patterns...>` - File glob patterns (e.g., `"src/**/*.ts" "!**/*.test.ts"`)
- `--no-gitignore` - Ignore .gitignore rules
- `--ignore-file <file>` - Path to custom ignore file (default: `.promptcode_ignore`)
- `-l, --list <file>` - Read file paths from a text file (one per line)
- `-i, --instructions <file>` - Path to markdown/text instructions file
- `-t, --template <name>` - Use a built-in or user template
- `-o, --out <file>` - Output file (default: stdout)
- `--json` - Output in JSON format with metadata

**Examples:**

```bash
# Generate prompt for TypeScript files
promptcode generate -f "src/**/*.ts" "!**/*.test.ts"

# Use code review template
promptcode generate -f "src/**/*.py" -t code-review

# Generate JSON output for automation
promptcode generate -f "lib/**/*.js" --json -o analysis.json

# Use custom instructions
echo "# Optimize for performance" > instructions.md
promptcode generate -i instructions.md

# Read file list from text file
find . -name "*.go" > files.txt
promptcode generate -l files.txt
```

### `stats` - Project statistics

Get quick insights about your project's token usage and file distribution.

```bash
promptcode stats [options]
```

**Options:**
- `-p, --path <dir>` - Project root directory (default: current directory)

**Example output:**
```
Project Statistics: my-project
──────────────────────────────────────────────────
Total files: 156
Total tokens: 45,230
Average tokens/file: 290

Top file types by token count:
  .ts              89 files      28,450 tokens  (62.9%)
  .tsx             23 files      10,230 tokens  (22.6%)
  .json            15 files       3,120 tokens  (6.9%)
  .md              12 files       2,890 tokens  (6.4%)
```

### `templates` - List available templates

View all available prompt templates.

```bash
promptcode templates
```

**Built-in templates:**
- `code-review` - Comprehensive code review
- `refactor` - Refactoring suggestions
- `optimize` - Performance optimization

**Custom templates:**
Place `.md` files in `~/.config/promptcode/prompts/` to create custom templates.

### `cache` - Manage token cache

Manage the token counting cache for performance optimization.

```bash
promptcode cache <action>
```

**Actions:**
- `clear` - Clear the token cache
- `stats` - Show cache statistics

### `diff` - Compare AI-suggested changes

Compare AI-generated code with existing files and optionally apply changes.

```bash
promptcode diff <prompt-file> [options]
```

**Options:**
- `-p, --path <dir>` - Project root directory (default: current directory)
- `--apply` - Apply the changes to files
- `--preview` - Show full preview of changes without applying

**Examples:**
```bash
# Compare AI response with current files
promptcode diff ai-response.json --preview

# Apply AI-suggested changes
promptcode diff ai-response.md --apply

# Extract and diff from saved prompt
promptcode generate --json -o prompt.json
# ... AI makes changes ...
promptcode diff prompt.json
```

### `context` - Manage file context

Manage persistent file selections for consistent AI interactions.

```bash
promptcode context <action> [files...] [options]
```

**Actions:**
- `add` - Add files to current context
- `remove/rm` - Remove files from context
- `list/ls` - Show current context
- `clear` - Clear all context
- `save` - Save current context with a name
- `load` - Load a saved context
- `saved` - List all saved contexts

**Options:**
- `-p, --path <dir>` - Project root directory
- `--save <name>` - Save context as named selection
- `--load <name>` - Load saved context

**Examples:**
```bash
# Add files to context
promptcode context add "src/**/*.ts" "!**/*.test.ts"

# List current context
promptcode context list

# Save context for later
promptcode context save --save "feature-x"

# Load saved context
promptcode context load --load "feature-x"

# Remove files
promptcode context remove "src/old-code.ts"
```

### `extract` - Extract code blocks

Extract code blocks from AI response files.

```bash
promptcode extract <response-file> [options]
```

**Options:**
- `--lang <language>` - Filter by language (e.g., typescript, python)
- `--save-dir <dir>` - Directory to save extracted files
- `--stdout` - Output to stdout instead of files

**Examples:**
```bash
# List code blocks in AI response
promptcode extract ai-response.md

# Extract only TypeScript code
promptcode extract ai-response.md --lang typescript

# Save all code blocks to directory
promptcode extract ai-response.md --save-dir ./extracted

# Output to stdout for piping
promptcode extract ai-response.md --stdout | grep "function"
```

### `watch` - Watch files and regenerate

Monitor files and automatically regenerate prompts on changes.

```bash
promptcode watch [options]
```

**Options:**
- `-p, --path <dir>` - Project root directory
- `-f, --files <patterns...>` - File patterns to watch
- `-o, --out <file>` - Output file to update
- `-t, --template <name>` - Template to use
- `--debounce <ms>` - Debounce time in milliseconds (default: 1000)

**Examples:**
```bash
# Watch TypeScript files and update prompt
promptcode watch -f "src/**/*.ts" -o context.md

# Watch with custom debounce
promptcode watch -f "**/*.py" --debounce 2000

# Watch and use template
promptcode watch -t code-review -o review-context.md
```

### `validate` - Validate AI-generated code

Check AI-generated code against project rules and security patterns.

```bash
promptcode validate <file> [options]
```

**Options:**
- `--rules <file>` - Custom validation rules file
- `--fix` - Attempt to auto-fix issues

**Built-in checks:**
- No console.log statements
- No debugger statements
- No exposed API keys or secrets
- No private keys
- TODO comment detection

**Examples:**
```bash
# Validate AI response
promptcode validate ai-response.md

# Use custom rules
promptcode validate code.ts --rules .promptcode/rules.json

# Auto-fix issues
promptcode validate ai-output.md --fix
```

## Output Format

### Standard Output

The CLI generates structured prompts in XML-like format:

```xml
<instructions>
Your instructions or template content here
</instructions>

<file_map>
project/
├── src/
│   ├── index.ts
│   └── utils.ts
└── package.json
</file_map>

<file_contents>
File: src/index.ts (125 tokens)
```typescript
// File content here
```

File: src/utils.ts (89 tokens)
```typescript
// File content here
```
</file_contents>
```

### JSON Output

With `--json` flag, outputs structured data:

```json
{
  "prompt": "...",
  "tokenCount": 1234,
  "sections": {
    "instructions": 150,
    "fileMap": 45,
    "fileContents": 1039,
    "resources": 0
  },
  "files": [
    {
      "path": "src/index.ts",
      "tokens": 125
    }
  ]
}
```

## AI Agent Integration

PromptCode CLI is specifically designed to enhance AI coding assistants' capabilities:

### Key Commands for AI Agents

1. **`context`** - Maintain persistent file selections across conversations
   ```bash
   # AI agents can save working context
   promptcode context add "src/feature/**/*.ts"
   promptcode context save --save "current-feature"
   ```

2. **`diff`** - Apply AI-generated changes safely
   ```bash
   # AI can generate code, then apply it
   promptcode diff ai-changes.md --preview
   promptcode diff ai-changes.md --apply
   ```

3. **`extract`** - Parse code from AI responses
   ```bash
   # Extract code blocks from conversation
   promptcode extract conversation.md --save-dir ./generated
   ```

4. **`watch`** - Monitor changes during development
   ```bash
   # Keep context updated as files change
   promptcode watch -f "src/**/*.ts" -o current-context.md
   ```

5. **`validate`** - Ensure generated code meets standards
   ```bash
   # Check AI-generated code for issues
   promptcode validate generated-code.ts
   ```

## Integration Examples

### With Claude Code

```bash
# Generate and copy to clipboard (macOS)
promptcode generate -f "src/**/*.ts" -t refactor | pbcopy

# Generate and save for later use
promptcode generate -f "src/**/*.ts" -o context.md
```

### In CI/CD Pipeline

```yaml
# GitHub Actions example
- name: Generate code context
  run: |
    npx promptcode-cli generate \
      -f "src/**/*.ts" \
      -t code-review \
      --json \
      -o context.json
    
- name: Run AI analysis
  run: |
    # Use the generated context with your AI tool
    cat context.json | your-ai-tool analyze
```

### Shell Scripts

```bash
#!/bin/bash
# analyze.sh - Generate context and analyze with AI

# Generate prompt
promptcode generate \
  -f "src/**/*.{ts,tsx}" \
  -t optimize \
  -o /tmp/context.md

# Send to AI (example with curl)
curl -X POST https://api.example.com/analyze \
  -H "Content-Type: text/plain" \
  --data-binary @/tmp/context.md
```

### Programmatic Use

```javascript
// Node.js example
import { execSync } from 'child_process';

const result = execSync('promptcode generate -f "src/**/*.ts" --json', {
  encoding: 'utf8'
});

const { prompt, tokenCount, files } = JSON.parse(result);
console.log(`Generated prompt with ${tokenCount} tokens from ${files.length} files`);
```

## Configuration

### Custom Ignore Patterns

Create `.promptcode_ignore` in your project root:

```
# .promptcode_ignore
*.log
build/
dist/
coverage/
*.tmp
.env*
```

### Custom Templates

Create templates in `~/.config/promptcode/prompts/`:

```bash
# ~/.config/promptcode/prompts/security-audit.md
# Security Audit

Please analyze the code for:
1. Authentication vulnerabilities
2. SQL injection risks
3. XSS vulnerabilities
4. Sensitive data exposure
5. Dependency vulnerabilities
```

## Tips

1. **Token Optimization**: Use `promptcode stats` to understand your project's token distribution
2. **Pattern Testing**: Test glob patterns with small sets first
3. **Template Reuse**: Create custom templates for common tasks
4. **Cache Management**: Clear cache after major refactoring with `promptcode cache clear`
5. **JSON for Automation**: Use `--json` output for integration with other tools

## Troubleshooting

### Binary not found
- Ensure the package is installed globally
- Check your PATH includes npm/bun global bin directory

### Permission denied
- Make the binary executable: `chmod +x /path/to/promptcode`

### Token count seems wrong
- Clear cache: `promptcode cache clear`
- Check for binary files being counted

## License

MIT - See LICENSE file in the root directory