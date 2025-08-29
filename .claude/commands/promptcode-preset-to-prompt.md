---
allowed-tools: Bash(promptcode generate:*), Bash(promptcode preset list:*), Bash(promptcode preset info:*), Glob(.promptcode/presets/*.patterns), Read(.promptcode/presets/*.patterns:*), Bash(command -v*), Bash(cursor*), Bash(code*), Bash(xdg-open*), Bash(open*), Bash(echo*), Bash(date*), Bash(wc*), Bash([[*), Bash(if*), Bash(elif*), Bash(else*), Bash(fi*), Bash(TMP*), Bash(PROMPT_FILE*)
description: Generate AI-ready prompt file from a promptcode preset with optional instructions
---

Generate prompt file from promptcode preset: $ARGUMENTS

## Instructions:

1. Parse arguments to understand what the user wants:
   - Extract preset name (first word/argument)
   - Extract optional instructions/question (remaining text after preset)
   - Look for output path keywords: "to", "in", "as" (e.g., "to ~/Desktop/", "as review.txt")

2. Parse instructions and output path:
   - If text after preset but before output keywords → instructions
   - Example: `api "Why is login slow?" to ~/Desktop/` 
     - preset = "api"
     - instructions = "Why is login slow?"
     - output = "~/Desktop/"
   - No instructions is valid (backward compatibility)

3. Check if preset exists:
   ```bash
   promptcode preset info {preset_name} 2>/dev/null
   ```
   - If not found, run `promptcode preset list` to show available presets
   - Suggest similar presets or offer to create one

4. Prepare output file:
   - Set temp directory: `TMP="${TMPDIR:-/tmp}"`
   - Default: `PROMPT_FILE="${TMP%/}/promptcode-{preset-name}-$(date +%Y%m%d-%H%M%S)-$$.txt"`
   - If user specified folder: `{folder}/promptcode-{preset-name}-$(date +%Y%m%d-%H%M%S)-$$.txt`
   - If user specified filename: use exactly as specified

5. Generate the prompt file:
   - With instructions:
     ```bash
     promptcode generate --preset "{preset_name}" -i "{instructions}" --output "$PROMPT_FILE"
     ```
   - Without instructions (backward compatible):
     ```bash
     promptcode generate --preset "{preset_name}" --output "$PROMPT_FILE"
     ```

6. Open the file for review:
   ```bash
   if command -v cursor &> /dev/null; then
     cursor "$PROMPT_FILE"
   elif command -v code &> /dev/null; then
     code "$PROMPT_FILE"
   elif [ -n "$EDITOR" ]; then
     "$EDITOR" "$PROMPT_FILE"
   elif command -v xdg-open &> /dev/null; then
     xdg-open "$PROMPT_FILE"
   elif command -v open &> /dev/null; then
     open "$PROMPT_FILE"
   else
     echo "📄 Prompt file created at: $PROMPT_FILE"
     echo "No editor found. Please open the file manually to review."
   fi
   ```

7. Report results:
   - Which preset was used
   - Whether instructions were included
   - Full path: `📄 Generated: $PROMPT_FILE`
   - Token count from the generate command output
   - If instructions: "✅ Ready for: `promptcode expert --prompt-file \"$PROMPT_FILE\"`"
   - If no instructions: "💡 Add your question at the top before using with expert"

## Examples of how users might call this

- `/promptcode-preset-to-prompt functional-framework` (no instructions)
- `/promptcode-preset-to-prompt api "Why is login slow?"` (with instructions)
- `/promptcode-preset-to-prompt microlearning analysis to ~/Desktop/`
- `/promptcode-preset-to-prompt api "Review security" as security-review.txt`
- `/promptcode-preset-to-prompt the functional code as analysis.txt`
