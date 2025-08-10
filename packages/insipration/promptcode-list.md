---
allowed-tools: Bash(uv run --project .claude/helpers/promptcode promptcode-list:*)
description: List all available promptcode presets with descriptions and stats
---

List all available promptcode presets with descriptions and stats.

Run the promptcode-list command:
```bash
uv run --project .claude/helpers/promptcode promptcode-list
```

The command will display a formatted table with all available presets, their descriptions, file counts, token estimates, and modification dates.