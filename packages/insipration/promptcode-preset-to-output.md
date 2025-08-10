---
allowed-tools: Bash(uv run --project .claude/helpers/promptcode promptcode-preset-to-output:*), Glob(.promptcode/presets/*.patterns), Read(.promptcode/presets/*.patterns:*)
description: Generate output file from a promptcode preset
---

Generate output file from promptcode preset: $ARGUMENTS

## Instructions:

1. Parse arguments to understand what the user wants:
   - If it's an exact preset name (like "functional-framework"), use it directly
   - If it's a description (like "all microlearning analysis code"), infer which preset matches best
   - Extract any output path/filename if specified (e.g., "to ~/Desktop/analysis.txt", "in /tmp/", "as myfile.txt")

2. If inferring from description:
   - Read available preset files to check their header comments: @.promptcode/presets/*.patterns
   - Match based on keywords and context
   - Choose the most relevant preset
   - If multiple matches, show options and pick the best one

3. Determine output path:
   - Default: `/tmp/promptcode-{preset-name}-{timestamp}.txt` where timestamp is YYYYMMDD-HHMMSS
   - If user specified just a folder: `{folder}/promptcode-{preset-name}-{timestamp}.txt`
   - If user specified filename without path: `/tmp/{filename}`
   - If user specified full path: use exactly as specified

4. Run the promptcode-preset-to-output command with determined preset and output path:
   ```bash
   uv run --project .claude/helpers/promptcode promptcode-preset-to-output "{preset_name}" "{output_path}"
   ```

5. Report results:
   - Which preset was used (especially important if inferred from description)
   - Full path to the output file
   - Token count and number of files included
   - Suggest next steps (e.g., "You can now open this file in your editor")

Examples of how users might call this:
- `/promptcode-preset-to-output functional-framework`
- `/promptcode-preset-to-output microlearning analysis to ~/Desktop/`
- `/promptcode-preset-to-output the one with all the functional code`
- `/promptcode-preset-to-output users-analysis as analysis.txt`