---
allowed-tools: Bash(promptcode expert:*), Bash(promptcode expert --estimate-cost:* --json), Bash(promptcode expert --models --json), Bash(promptcode preset:*), Bash(promptcode generate:*), Bash(promptcode generate --preset:* --output:*), Bash(mktemp:*), Read(/tmp/*), Write(/tmp/*), Read(/var/folders/*), Write(/var/folders/*), Task, Bash(command -v:*), Bash(cursor:*), Bash(code:*), Bash(echo:*), Bash(cat:*), Bash(xdg-open:*), Bash(open:*), Bash(wc:*), Bash(date:*), Bash(mkdir:*), Bash(touch:*), Bash(ls:*), Bash(pwd:*), Bash(export:*), Bash(grep:*), Bash(sed:*), Bash(awk:*), Bash(tr:*), Bash(cut:*), Bash(sort:*), Bash(uniq:*), Bash(head:*), Bash(tail:*), Bash(rm:*), Bash(cp:*), Bash(mv:*), Bash(find:*), Bash(which:*), Bash(test:*), Bash([[:*), Bash(TMP=*), Bash(PROMPT_FILE=*), Bash(CODE_FILE=*), Bash(SYNTHESIS_FILE=*), Bash(TMPDIR:*), Bash(*TMPDIR*), Bash(*date*), Bash(*echo*), Bash(*cat*), Bash(*promptcode generate*), Bash(*promptcode preset*), Bash(*promptcode expert*)
description: Consult AI expert for complex problems with code context - supports ensemble mode for multiple models
---

Consult an expert about: $ARGUMENTS

## Instructions:

1. Analyze the request in $ARGUMENTS:
   - Extract the main question/problem
   - Identify if code context would help (look for keywords about implementation, feature, code review, etc.)
   - Check for multiple model requests (e.g., "compare using gpt-5 and opus-4", "ask gpt-5, sonnet-4, and gemini")
   - Get available models dynamically: `promptcode expert --models --json` (parse the JSON for model list)
   - If 2+ models detected → use ensemble mode
   - For single model: Use gpt-5 (the default) unless user explicitly specifies another model

2. Determine code context needs:
   ```bash
   promptcode preset list
   ```
   - Check if an existing preset matches the request (e.g., "security" → look for security-related presets)
   - If no suitable preset exists, create one:
     ```bash
     promptcode preset create {descriptive-name}
     ```
     Then edit `.promptcode/presets/{descriptive-name}.patterns` to add relevant file patterns.
     Or use `--from-files` with specific patterns:
     ```bash
     promptcode preset create {descriptive-name} --from-files "src/**/*.ts" "tests/**/*.test.ts"
     ```
   - Verify the preset:
     ```bash
     promptcode preset info {preset-name}
     ```

3. Prepare consultation file for review:
   - Set temp directory: `TMP="${TMPDIR:-/tmp}"`
   - Create unique files: `PROMPT_FILE="${TMP%/}/expert-consultation-$(date +%Y%m%d-%H%M%S)-$$.txt"`
   - Structure the file with:
     ```markdown
     # Expert Consultation
     
     ## Question
     {user's question}
     
     ## Context
     {any relevant context or background}
     
     ## Code Context
     ```
   - Append the code context using the preset:
     ```bash
     CODE_FILE="${TMP%/}/code-context-$(date +%Y%m%d-%H%M%S)-$$.txt"
     promptcode generate --preset "{preset_name}" --output "$CODE_FILE"
     cat "$CODE_FILE" >> "$PROMPT_FILE"
     ```

4. Open consultation for user review:
   ```bash
   # Try cursor first, then code, then EDITOR, then xdg-open/open
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
     echo "📄 Consultation file created at: $PROMPT_FILE"
     echo "No editor found. Please open the file manually to review."
   fi
   ```
   
5. Estimate cost and get approval:
   ```bash
   promptcode expert --prompt-file "$PROMPT_FILE" --model <model> --estimate-cost --json
   ```
   - Parse JSON for `cost.total` and `tokens.input`
   - Exit code: 0 = success, 2 = approval required (cost > threshold)
   
   **For single model:**
   - Say: "Ready to consult {model} using preset '{preset_name}' ({tokens} tokens, ~${cost}). Reply 'yes' to proceed."
   
   **For ensemble mode (multiple models):**
   - Run --estimate-cost for each model in parallel
   - Say: "Ready for ensemble consultation with {models} ({total_tokens} tokens). Total: ${total_cost} ({model1}: ${cost1}, {model2}: ${cost2}). Reply 'yes' to proceed."
   
   **Important: Ask for approval ONLY ONCE - after showing cost estimate**

6. Execute based on mode:

   **Single Model Mode:**
   ```bash
   promptcode expert --prompt-file "$PROMPT_FILE" --model {model} --yes
   ```
   
   **Ensemble Mode (Parallel Execution):**
   - Use a SINGLE parent Task that orchestrates parallel sub-tasks (idiomatic for Claude Code)
   - The parent Task:
     1. Launches parallel sub-tasks for each model
     2. Waits for all sub-tasks to complete
     3. Reads all response files
     4. Creates the synthesis report (Step 7)
   - Structure:
     ```
     Task: "Ensemble consultation with {model1} and {model2}"
     Prompt: "
       Step 1: Run these consultations in PARALLEL as sub-tasks:
       - Sub-task 1: promptcode expert --prompt-file '$PROMPT_FILE' --model {model1} --yes --output /tmp/expert-{model1}.txt
       - Sub-task 2: promptcode expert --prompt-file '$PROMPT_FILE' --model {model2} --yes --output /tmp/expert-{model2}.txt
       
       Step 2: After both complete, read the response files
       Step 3: Create synthesis report as described in Step 7
       Step 4: Report back with synthesis and winner
     "
     ```
   - Note: The --yes flag confirms we have user approval for the cost
   - The allowed-tools configuration permits these commands to run without additional prompts

7. Handle the response:

   **Single Model Mode:**
   - If successful: Open response in Cursor (if available) and summarize key insights
   - If API key missing: Show appropriate setup instructions
   
   **Ensemble Mode (Synthesis):**
   - Read all response text files
   - Extract key insights from each model's response
   - Create synthesis report: `SYNTHESIS_FILE="${TMP%/}/expert-synthesis-$(date +%Y%m%d-%H%M%S)-$$.txt"`
   
   ```markdown
   # Ensemble Expert Consultation Results
   
   ## Question
   {original_question}
   
   ## Expert Responses
   
   ### {Model1} - ${actual_cost}, {response_time}s
   **Key Points:**
   - {key_point_1}
   - {key_point_2}
   - {key_point_3}
   
   ### {Model2} - ${actual_cost}, {response_time}s
   **Key Points:**
   - {key_point_1}
   - {key_point_2}
   - {key_point_3}
   
   ## Synthesis
   
   **Consensus Points:**
   - {point_agreed_by_multiple_models}
   - {another_consensus_point}
   
   **Best Comprehensive Answer:** {Model} provided the most thorough analysis, particularly strong on {specific_aspect}
   
   **Unique Insights:**
   - {Model1}: {unique_insight_from_model1}
   - {Model2}: {unique_insight_from_model2}
   
   **🏆 WINNER:** {winning_model} - {clear_reason_why_this_model_won}
   (If tie: "TIE - Both models provided equally valuable but complementary insights")
   
   **Performance Summary:**
   - Total Cost: ${total_actual_cost}
   - Total Time: {total_time}s
   - Best Value: {model_with_best_cost_to_quality_ratio}
   ```
   
   - Open synthesis in Cursor if available
   - IMPORTANT: Always declare a clear winner (or explicitly state if it's a tie)
   - Provide brief summary of which model performed best and why they won

   **Error Handling:**
   - If any model fails in ensemble mode, continue with successful ones
   - Report which models succeeded/failed
   - If OPENAI_API_KEY missing:
     ```
     To use expert consultation, set your OpenAI API key:
     export OPENAI_API_KEY=sk-...
     Get your key from: https://platform.openai.com/api-keys
     ```
   - For other errors: Report exact error message

## Important:
- **Always use presets** - either existing or create new ones for code context
- **Single approval flow**: Estimate cost → Ask user ONCE → Execute with --yes
- **Show the preset name** to the user so they know what context is being used
- **Default model is gpt-5** - use this unless user explicitly requests another model
- Discover default model via `promptcode expert --models --json` (look for `defaultModel: "gpt-5"`)
- For ensemble mode: limit to maximum 4 models
- NEVER automatically add --yes without user approval
- Reasoning effort defaults to 'high' (set in CLI) - no need to specify
- Always use `--output` flag instead of stdout redirection for reliability