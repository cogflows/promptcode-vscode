---
allowed-tools: Bash(promptcode generate:*), Bash(promptcode preset list:*), Glob(.promptcode/presets/*.patterns), Read(.promptcode/presets/*.patterns:*)
description: Generate AI-ready prompt file from a promptcode preset with optional instructions
---

Generate prompt file from promptcode preset: $ARGUMENTS

## Instructions:

1. Parse arguments to understand what the user wants:
   - Extract preset name or description (may be quoted)
   - Detect explicit instructions delimiter:
     - If arguments contain " -- " (space, two dashes, space), everything after it is the instructions (preserve verbatim)
     - Else, look for explicit -i or --instructions value; if provided, use it verbatim as instructions
   - Keep remaining tokens for output path and/or fallback instructions

2. If inferring from description:
   - Run `promptcode preset list` to see available presets
   - Read header comments from `.promptcode/presets/*.patterns` files if needed
   - Match based on keywords and context
   - Choose the most relevant preset

3. Determine output path and instructions (fallback):
   - Resolve output path using existing keywords:
     - "to [path]" means explicit file path (or folder if ends with '/')
     - "in [folder]" means folder
     - "as [filename]" means filename in /tmp unless combined with "in"
   - After removing path-spec tokens, if instructions were NOT set via delimiter or -i/--instructions and there are remaining tokens:
     - Treat remaining tokens (in original order) as the instructions (fallback mode)
   - Default output path: `/tmp/promptcode-{preset-name}-{timestamp}.txt` where timestamp is YYYYMMDD-HHMMSS

4. Generate the prompt file:
   - If instructions are present, pass them using --instructions (alias -i)
   - IMPORTANT: Shell-escape the instructions:
     - Always wrap the final string in single quotes
     - Replace any single quote ' inside the instructions with '\'' (close-quote, escaped quote, reopen-quote)
   - Command forms:

     ```bash
     # Without instructions:
     promptcode generate --preset "{preset_name}" --output "{output_path}"
     
     # With instructions (INSTR_ESC = instructions with ' replaced by '\''):
     promptcode generate --preset "{preset_name}" --output "{output_path}" --instructions '{INSTR_ESC}'
     ```

5. Report results:
   - Which preset was used (especially important if inferred)
   - Full path to the output file
   - Whether instructions were included (show first ~120 chars for confirmation)
   - Token count and number of files included
   - Suggest next steps (e.g., "You can now open this file in your editor")

## Examples of how users might call this

- `/promptcode-preset-to-prompt functional-framework`
- `/promptcode-preset-to-prompt functional-framework -- Review for security and performance`
- `/promptcode-preset-to-prompt functional-framework to ~/Desktop/analysis.txt -- How to migrate to TS 5.6?`
- `/promptcode-preset-to-prompt functional-framework in ~/Desktop as analysis.txt -- Identify dead code`
- `/promptcode-preset-to-prompt "functional framework" -i "Focus on memory leaks in parsers"`
- `/promptcode-preset-to-prompt microlearning analysis to ~/Desktop/`
- `/promptcode-preset-to-prompt the functional code as analysis.txt`
