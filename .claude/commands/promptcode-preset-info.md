---
allowed-tools: Bash(promptcode preset info:*), Bash(promptcode preset list:*), Glob(.promptcode/presets/*.patterns), Read(.promptcode/presets/*.patterns:*)
description: Show detailed information about a promptcode preset
---

Show detailed information about promptcode preset: $ARGUMENTS

## Instructions:

1. Parse the arguments to identify the preset:
   - If exact preset name provided (e.g., "functional-framework"), use it directly
   - If description provided, infer the best matching preset:
     - Run `promptcode preset list` to see available presets
     - Read header comments from preset files in `.promptcode/presets/` if needed
     - Match based on keywords and context
     - Choose the most relevant preset

2. Run the promptcode info command with the determined preset name:
   ```bash
   promptcode preset info "{preset_name}"
   ```

3. If a preset was inferred from description, explain which preset was chosen and why.

The output will show:
- Preset name and path
- Description from header comments
- File count and token statistics
- Pattern details
- Sample files included
- Usage instructions

## Optimizing Presets

If the preset has many patterns or includes too many files, you can optimize it:
```bash
promptcode preset optimize "{preset_name}"           # Preview optimization
promptcode preset optimize "{preset_name}" --write   # Apply optimization
```

Optimization reduces pattern count while maintaining file coverage.