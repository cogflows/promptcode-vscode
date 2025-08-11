---
allowed-tools: Bash(promptcode generate:*), Bash(promptcode preset list:*), Glob(.promptcode/presets/*.patterns), Read(.promptcode/presets/*.patterns:*)
description: Generate AI-ready prompt file from a promptcode preset
---

Generate prompt file from promptcode preset: $ARGUMENTS

## Instructions:

1. Parse arguments to understand what the user wants:
   - Extract preset name or description
   - Extract output path/filename if specified (e.g., "to ~/Desktop/analysis.txt", "in /tmp/", "as myfile.txt")

2. If inferring from description:
   - Run `promptcode preset list` to see available presets
   - Read header comments from `.promptcode/presets/*.patterns` files if needed
   - Match based on keywords and context
   - Choose the most relevant preset

3. Determine output path:
   - Default: `/tmp/promptcode-{preset-name}-{timestamp}.txt` where timestamp is YYYYMMDD-HHMMSS
   - If user specified just a folder: `{folder}/promptcode-{preset-name}-{timestamp}.txt`
   - If user specified filename without path: `/tmp/{filename}`
   - If user specified full path: use exactly as specified

4. Generate the prompt file:
   ```bash
   promptcode generate --preset "{preset_name}" --output "{output_path}"
   ```

5. Report results:
   - Which preset was used (especially important if inferred)
   - Full path to the output file
   - Token count and number of files included
   - Suggest next steps (e.g., "You can now open this file in your editor")

## Examples of how users might call this:
- `/promptcode-preset-to-prompt functional-framework`
- `/promptcode-preset-to-prompt microlearning analysis to ~/Desktop/`
- `/promptcode-preset-to-prompt the functional code as analysis.txt`