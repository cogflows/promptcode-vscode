---
allowed-tools: Task, Read(/tmp/*), Read(/var/folders/*), Write(/tmp/*), Write(/var/folders/*), Edit(/tmp/*), Edit(/var/folders/*), Edit(.promptcode/presets/*), Bash, Bash(*)
description: Consult AI expert for complex problems with code context - supports ensemble mode for multiple models
---

Consult an expert about: $ARGUMENTS

## Instructions:

1. Analyze the request in $ARGUMENTS:
   - Extract the main question/problem
   - Identify if code context would help (look for keywords about implementation, feature, code review, etc.)
   - If the user mentions screenshots/images/mocks: ask for image file paths; plan to run with vision models using `--images` or `--allow-images`
   - Check for multiple model requests (e.g., "compare using gpt-5 and opus-4", "ask gpt-5, sonnet-4, and gemini")
   - Get available models dynamically: `promptcode expert --models --json` (parse the JSON for model list)
   - If 2+ models detected → use ensemble mode
   - For single model: Use gpt-5.1 (the default) unless user explicitly specifies another model
   - Vision-capable models: gpt-5/5.1 (+ mini/nano), sonnet/opus 4.x, gemini-3-pro/2.5, grok-4. Background mode is disabled when images are attached.

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
   - Parse JSON for cost estimate using correct schema:
     - Total cost: `.cost.total`
     - Input tokens: `.tokens.input`
   - Exit code: Always 0 for estimate (not 2 - that's for actual consultation requiring approval)
   
   **For single model:**
   - Say: "Ready to consult {model} using preset '{preset_name}' ({tokens} tokens, ~${cost}). Reply 'yes' to proceed."
   
   **For ensemble mode (multiple models):**
   - Run --estimate-cost for each model in parallel
   - Say: "Ready for ensemble consultation with {models} ({total_tokens} tokens). Total: ${total_cost} ({model1}: ${cost1}, {model2}: ${cost2}). Reply 'yes' to proceed."
   
   **Important: Ask for approval ONLY ONCE - after showing cost estimate**

6. Execute based on mode:

   **Single Model Mode:**

   **For fast models (gpt-5, sonnet-4, opus-4, gemini-2.5-pro, grok-4, etc.):**
   Run in foreground:
   ```bash
   promptcode expert --prompt-file "$PROMPT_FILE" --model {model} --yes --json
   ```

   **For long-running models (gpt-5-pro - can take 10-120 minutes):**
   Use the Task tool for non-blocking execution. The CLI will automatically switch to
   OpenAI's background API for GPT-5 Pro, so no manual timeout wrapper is needed.

   1. Create result file path using temp directory:
      ```bash
      TMP="${TMPDIR:-/tmp}"
      RESULT_FILE="${TMP%/}/expert-result-$(date +%Y%m%d-%H%M%S)-$$.json"
      ```

   2. Inform the user:
      ```
      ⏳ Starting background consultation with {model}...
         This may take a long time (10-120 min). Launching as autonomous Task...
         Prompt file: $PROMPT_FILE
         Results will be saved to: $RESULT_FILE
         You can continue working - the Task will report back when complete.
      ```

   3. **Invoke the Task tool directly** with concrete paths and explicit tool usage:
      ```
      Task("Consult {model}: {short_question_summary}", """
You have access to: Bash, Read(/tmp/*), Read(/var/folders/*), Write(/tmp/*), Write(/var/folders/*).

Your task: Run a long-running AI consultation (10-120 minutes) and report back with results.

**Step 1: Run consultation and capture JSON to stdout**
Use Bash tool to run:
promptcode expert --prompt-file "{absolute_path_to_PROMPT_FILE}" --model {model} --yes --json > "{absolute_path_to_RESULT_FILE}"
EXIT=$?

Notes:
- Replace {absolute_path_to_PROMPT_FILE} with actual path (e.g., /var/folders/.../expert-consultation-20251011-094021-48499.txt)
- Replace {absolute_path_to_RESULT_FILE} with actual path (e.g., /var/folders/.../expert-result-20251011-094021-48499.json)
- --json outputs structured JSON to stdout (NOT to --output file!)
- Redirect stdout to capture JSON: > "{absolute_path_to_RESULT_FILE}"
- Capture exit code in $EXIT variable

**Step 2: Check exit code and classify status**
Use Bash tool:
if [ $EXIT -eq 0 ]; then
  STATUS="SUCCESS"
else
  STATUS="FAILED"
fi

**Step 3: Read and parse JSON result (only if SUCCESS)**
If STATUS is SUCCESS:
- Use Read tool to read: {absolute_path_to_RESULT_FILE}
- Parse the JSON using correct schema:
  - Response text: .response
  - Actual cost: .costBreakdown.actualTotal
  - Input tokens: .usage.promptTokens
  - Output tokens: .usage.completionTokens
  - Response time: .responseTime (in seconds)

**Step 4: Report back**
Return a structured report:
- Status: SUCCESS | FAILED | TIMEOUT
- Model: {model}
- Cost: $X.XX (from .costBreakdown.actualTotal)
- Tokens: X input, Y output (from .usage.promptTokens and .usage.completionTokens)
- Response time: X.Xs (from .responseTime)
- Summary: Brief summary of key insights from .response (2-3 sentences)
- Result file: {absolute_path_to_RESULT_FILE}

**On TIMEOUT or FAILED:**
- Report the status and exit code
- If result file exists, include any partial output
- Surface key stderr lines from the CLI (timeouts show "TimeoutError")
- No need for full error details - just status

Return all information to the main conversation so the user can see the results.
""")
      ```

      **Important**: Replace all placeholder paths with actual absolute paths before invoking Task.

   4. Return immediately so user can continue working
   5. Task runs autonomously and persists across Claude Code sessions
   6. When Task completes and reports back, summarize the findings for the user
   
   **Ensemble Mode (Parallel Execution):**

   Create unique result files for each model:
   ```bash
   TMP="${TMPDIR:-/tmp}"
   RESULT_FILE_1="${TMP%/}/expert-{model1}-$(date +%Y%m%d-%H%M%S)-$$.json"
   RESULT_FILE_2="${TMP%/}/expert-{model2}-$(date +%Y%m%d-%H%M%S)-$$.json"
   SYNTHESIS_FILE="${TMP%/}/expert-synthesis-$(date +%Y%m%d-%H%M%S)-$$.md"
   # Add more for additional models (max 4)
   ```

   Inform the user:
   ```
   ⏳ Starting ensemble consultation with {model1}, {model2}...
      This will run in parallel. Each model may take 1-10 minutes.
      Launching parallel Tasks...
      You can continue working - I'll synthesize results when both complete.
   ```

   **Launch parallel Tasks at top level (not nested):**

   Invoke Task for model1:
   ```
   Task("Consult {model1}: {short_question}", """
You have access to: Bash, Read(/tmp/*), Read(/var/folders/*).

Run consultation with timeout and capture JSON:
timeout 15m promptcode expert --prompt-file "{absolute_path_to_PROMPT_FILE}" --model {model1} --yes --json > "{absolute_path_to_RESULT_FILE_1}"
EXIT=$?

Classify status:
if [ $EXIT -eq 0 ]; then STATUS="SUCCESS"
elif [ $EXIT -eq 124 ]; then STATUS="TIMEOUT"
else STATUS="FAILED"; fi

If SUCCESS, read JSON from {absolute_path_to_RESULT_FILE_1} and parse:
- Response: .response
- Cost: .costBreakdown.actualTotal
- Tokens: .usage.promptTokens, .usage.completionTokens
- Time: .responseTime

Return structured report:
- Status: SUCCESS|TIMEOUT|FAILED
- Model: {model1}
- Cost: $X.XX
- Tokens: X in, Y out
- Time: X.Xs
- File: {absolute_path_to_RESULT_FILE_1}
""")
   ```

   Invoke Task for model2 (in same turn, runs in parallel):
   ```
   Task("Consult {model2}: {short_question}", """
You have access to: Bash, Read(/tmp/*), Read(/var/folders/*).

Run consultation with timeout and capture JSON:
timeout 15m promptcode expert --prompt-file "{absolute_path_to_PROMPT_FILE}" --model {model2} --yes --json > "{absolute_path_to_RESULT_FILE_2}"
EXIT=$?

Classify status:
if [ $EXIT -eq 0 ]; then STATUS="SUCCESS"
elif [ $EXIT -eq 124 ]; then STATUS="TIMEOUT"
else STATUS="FAILED"; fi

If SUCCESS, read JSON from {absolute_path_to_RESULT_FILE_2} and parse:
- Response: .response
- Cost: .costBreakdown.actualTotal
- Tokens: .usage.promptTokens, .usage.completionTokens
- Time: .responseTime

Return structured report:
- Status: SUCCESS|TIMEOUT|FAILED
- Model: {model2}
- Cost: $X.XX
- Tokens: X in, Y out
- Time: X.Xs
- File: {absolute_path_to_RESULT_FILE_2}
""")
   ```

   **After both Tasks complete:**

   1. Read both result JSON files using Read tool
   2. Parse each using correct schema (.response, .costBreakdown.actualTotal, etc.)
   3. Create synthesis report using Write tool at {absolute_path_to_SYNTHESIS_FILE}:

   ```markdown
   # Ensemble Expert Consultation Results

   ## Question
   {original_question}

   ## Expert Responses

   ### {Model1} - ${actual_cost}, {time}s
   **Key Points:**
   - [Extract 3-4 main insights from .response]

   ### {Model2} - ${actual_cost}, {time}s
   **Key Points:**
   - [Extract 3-4 main insights from .response]

   ## Synthesis

   **Consensus Points:**
   - [Where both models agree]

   **Divergent Views:**
   - {Model1}: [Unique insight]
   - {Model2}: [Unique insight]

   **🏆 WINNER: {model_name}**
   Reason: [Clear, specific reason - e.g., "More thorough analysis", "Better practical recommendations"]

   (Or: "TIE - Both provided equally valuable but complementary insights")

   **Performance Summary:**
   - Total Cost: ${total}
   - {Model1}: ${cost1}, {time1}s
   - {Model2}: ${cost2}, {time2}s
   ```

   4. Open synthesis file in Cursor if available
   5. Report winner and key findings to user

   **Important**:
   - Replace all placeholder paths with actual absolute paths
   - Invoke both Tasks in same turn for parallel execution
   - Limit to maximum 4 models for practical reasons
   - User has already approved costs via --yes flag

7. Handle the response:

   **Single Model Mode (Fast Models - Foreground):**
   - Command returns JSON with structured output
   - Parse JSON for cost, tokens, timing, and response
   - Summarize key insights to user
   - If result file was created, optionally open in Cursor/editor

   **Single Model Mode (Long-Running - Background Task):**
   - Task will report back when complete (happens in background)
   - When Task returns, it provides structured summary
   - Share the summary with user
   - Open result file in Cursor if available

   **Ensemble Mode (Background Task):**
   - Parent Task orchestrates parallel consultations
   - When Task completes, it provides:
     - Synthesis file path
     - Winner declaration with reasoning
     - Cost and timing breakdown
   - Share summary with user
   - Open synthesis file in Cursor if available

   **Error Handling:**
   - If any model fails in ensemble mode, Task will continue with successful ones and report which failed
   - If API key missing:
     ```
     To use expert consultation, set your OpenAI API key:
     export OPENAI_API_KEY=sk-...
     Get your key from: https://platform.openai.com/api-keys
     ```
   - For other errors: Report exact error message from Task or CLI
   - Timeout errors: Report which model timed out (exceeded 15 minutes)

## Important:
- **Always use presets** - either existing or create new ones for code context
- **Single approval flow**: Estimate cost → Ask user ONCE → Execute with --yes
- **Show the preset name** to the user so they know what context is being used
- **Default model is gpt-5.1** - use this unless user explicitly requests another model
- For ensemble mode: limit to maximum 4 models
- NEVER automatically add --yes without user approval
- **JSON output modes**:
  - Fast models (foreground): `--json` outputs to stdout, parse directly
  - Long-running (Task): Redirect stdout to file: `--json > "$FILE"`, then Read file
  - Never use `--output` with `--json` (--output writes plain text, not JSON!)
- **JSON schema differences**:
  - Estimate mode: Use `.cost.total`, `.tokens.input`
  - Actual result: Use `.response`, `.costBreakdown.actualTotal`, `.usage.promptTokens/.completionTokens`, `.responseTime`
- **Timeout protection**: All consultations use `timeout 15m` command, exit code 124 = timeout
- **Task-based execution**: For long-running models (gpt-5-pro, o3-pro), use Task tool for non-blocking execution
  - Pass concrete absolute file paths to Task (not shell variables like $PROMPT_FILE)
  - Explicitly state tool usage (Bash, Read, Write) in Task prompt
  - Capture exit code: `EXIT=$?` after command, then classify: 0=SUCCESS, 124=TIMEOUT, else=FAILED
  - Task provides true non-blocking execution that persists across sessions
  - Task will report back when complete
- **Fast vs slow models**: Fast models (gpt-5, sonnet-4, opus-4, etc) take <30s and run in foreground. Long-running models (gpt-5-pro, o3-pro) take 1-10 minutes and should use Task tool
- **Ensemble execution**: Invoke multiple Tasks at top level in same turn for parallel execution (not nested Tasks!)
  - Each Task runs one model consultation
  - After all Tasks complete, synthesize results yourself
  - Declare clear winner with reasoning
- **File paths**: Always use `${TMPDIR:-/tmp}` pattern for cross-platform temp directories (macOS uses /var/folders, Linux uses /tmp)
- Reasoning effort defaults to 'high' (set in CLI) - no need to specify
