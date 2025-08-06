# PromptCode CLI Environment Variables and Flags Analysis

## Current Environment Variables

### Test/CI Related
- `PROMPTCODE_TEST` - Indicates test mode, disables interactive features, forces process.exit()
- `PROMPTCODE_TOKEN_WARNING` - Token threshold for warning (default: 50000)
- `CI` - Standard CI environment indicator
- `NO_COLOR` - Disable colored output
- `DEBUG` - Enable debug logging (e.g., DEBUG='promptcode:*')

### Configuration/Paths
- `XDG_CONFIG_HOME` - Config directory (defaults to ~/.config)
- `XDG_CACHE_HOME` - Cache directory (defaults to ~/.cache)
- `HOME` - User home directory
- `EDITOR` - Default text editor
- `CLAUDE_PROJECT_DIR` - Claude project directory

### API Keys (Multiple Aliases)
- OpenAI: `OPENAI_API_KEY`, `OPENAI_KEY`
- Anthropic: `ANTHROPIC_API_KEY`, `CLAUDE_API_KEY`
- Google: `GOOGLE_API_KEY`, `GOOGLE_CLOUD_API_KEY`, `GOOGLE_AI_API_KEY`, `GEMINI_API_KEY`
- xAI: `XAI_API_KEY`, `GROK_API_KEY`

## Command Line Flags

### Common/Global Flags
- `-p, --path <dir>` - Project directory (appears in most commands)
- `--json` - JSON output mode
- `-y, --yes` - Skip confirmation prompts (aliases: --force, --no-confirm)
- `-o, --out <file>` / `--output <file>` - Output file (duplicated)

### File Selection
- `-f, --files <patterns...>` - File patterns
- `-l, --list <file>` / `--preset <name>` / `-p, --preset <name>` - Preset usage (confusing overlap)
- `--no-gitignore` - Ignore .gitignore rules
- `--save-preset <name>` - Save patterns as preset

### Expert/AI Mode
- `--model <model>` - AI model selection
- `--stream` - Stream response
- `--no-confirm` - Skip cost confirmation

## Issues and Recommendations

### 1. Naming Inconsistencies
**Problem**: Multiple names for similar concepts
- `--yes`, `--force`, `--no-confirm` all skip prompts
- `--out` and `--output` are aliases
- `-p` means both `--path` and `--preset` in different contexts

**Recommendation**: Standardize to single, clear names
```
--yes (preferred over --force, --no-confirm)
--output (deprecate --out)
-p for --preset only, use --path for directory
```

### 2. Environment Variable Proliferation
**Problem**: Too many API key aliases
- 4 different names for Google API key
- 2 names each for OpenAI, Anthropic, xAI

**Recommendation**: Single canonical name per provider
```
OPENAI_API_KEY (deprecate OPENAI_KEY)
ANTHROPIC_API_KEY (deprecate CLAUDE_API_KEY)
GOOGLE_API_KEY (deprecate others)
XAI_API_KEY (deprecate GROK_API_KEY)
```

### 3. Test Mode Complexity
**Problem**: Multiple test-related flags
- PROMPTCODE_TEST for test mode
- PROMPTCODE_TOKEN_WARNING for threshold
- CI, NO_COLOR for CI environments

**Recommendation**: Consolidate under single namespace
```
PROMPTCODE_ENV=test|development|production
PROMPTCODE_TOKEN_THRESHOLD=50000
PROMPTCODE_INTERACTIVE=false (replaces PROMPTCODE_TEST)
```

### 4. Debug Configuration
**Problem**: Generic DEBUG variable could conflict

**Recommendation**: Already good with namespace (DEBUG='promptcode:*')

## Proposed Consolidated Environment Variables

```bash
# Core Configuration
PROMPTCODE_ENV=test|development|production
PROMPTCODE_INTERACTIVE=true|false
PROMPTCODE_TOKEN_THRESHOLD=50000
PROMPTCODE_DEBUG=true|false (or use DEBUG='promptcode:*')

# Paths (keep standard XDG)
XDG_CONFIG_HOME
XDG_CACHE_HOME

# API Keys (single canonical name)
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
XAI_API_KEY

# CI/Display
CI
NO_COLOR
```

## Proposed CLI Flag Consolidation

```bash
# Global flags (available on all commands)
--path <dir>         # Project directory
--json              # JSON output
--yes               # Skip all confirmations
--output <file>     # Output to file

# File selection
--files <patterns>  # File patterns
--preset <name>     # Use preset (no more -l, --list)
--save-preset       # Save as preset
--no-gitignore      # Ignore .gitignore

# AI/Expert specific
--model <name>      # Model selection
--stream            # Stream output
--max-cost <amount> # Cost limit (replaces token warning)
```

## Migration Strategy

1. **Phase 1**: Add new flags/env vars alongside old ones
2. **Phase 2**: Deprecation warnings for old flags
3. **Phase 3**: Remove old flags in next major version

## Benefits of Consolidation

1. **Simpler mental model** - Users learn fewer flags
2. **Less confusion** - No overlapping `-p` meanings
3. **Better discoverability** - Consistent naming patterns
4. **Easier testing** - Single PROMPTCODE_ENV instead of multiple flags
5. **Future-proof** - Clear namespace prevents conflicts