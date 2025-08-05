---
allowed-tools: Bash(uv run --project .claude/helpers/promptcode promptcode-info:*), Glob(.promptcode/presets/*.patterns), Read(.promptcode/presets/*.patterns:*)
description: Show detailed information about a promptcode preset
---

Show detailed information about promptcode preset: $ARGUMENTS

## Instructions:

1. Parse the arguments to identify the preset:
   - If exact preset name provided (e.g., "functional-framework"), use it directly
   - If description provided, infer the best matching preset:
     - List available presets from `/.promptcode/presets/`
     - Read header comments from each preset file
     - Match based on keywords and context
     - Choose the most relevant preset

2. Run the promptcode-info command with the determined preset name:
   ```bash
   uv run --project .claude/helpers/promptcode promptcode-info "{preset_name}"
   ```

3. If a preset was inferred from description, explain which preset was chosen and why.

Example output:
```
Preset: functional-framework
Path: /.promptcode/presets/functional-framework.patterns

Description:
# Core functional programming utilities from cogflows-commons
# Includes pipe, placeholders, and all verb functions

Statistics:
- Files: 31
- Total tokens: ~34,804
- Average per file: ~1,123 tokens
- File types: 28 .py, 3 .md

Patterns (4 total):
✓ python/cogflows-py/packages/cogflows-commons/src/cogflows_commons/functional/**/*.py
✓ python/cogflows-py/packages/cogflows-commons/tests/functional/**/*.py
✗ !**/__pycache__/**
✗ !**/*.pyc

Sample files:
- functional/base.py (2,341 tokens)
- functional/pipe.py (1,876 tokens)
- functional/verbs/filtering.py (987 tokens)
[... more files ...]

Usage:
- Generate output: /promptcode-preset-to-output functional-framework
- Generate to specific location: /promptcode-preset-to-output functional-framework to ~/Desktop/functional.txt
```