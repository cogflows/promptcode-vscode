---
allowed-tools: Task, Read(/tmp/*), Write(/tmp/*), Edit(/tmp/*), Edit(.promptcode/presets/*), Bash, Bash(*)
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

   **For fast models (gpt-5, sonnet-4, opus-4, gemini-2.5-pro, grok-4, etc.):**
   Run in foreground:
   ```bash
   promptcode expert --prompt-file "$PROMPT_FILE" --model {model} --yes --json
   ```

   **For long-running models (gpt-5-pro, o3-pro - can take 1-10 minutes):**
   Use the Task tool for non-blocking execution (idiomatic Claude Code pattern):

   1. Create result file path with concrete absolute path:
      ```bash
      RESULT_FILE="${TMP%/}/expert-result-$(date +%Y%m%d-%H%M%S)-$$.json"
      ```

   2. Inform the user:
      ```
      ⏳ Starting background consultation with {model}...
         This may take several minutes (1-10 min). Launching as autonomous Task...
         Prompt file: $PROMPT_FILE
         Results will be saved to: $RESULT_FILE
         You can continue working - the Task will report back when complete.
      ```

   3. **Invoke the Task tool directly** with concrete paths and explicit tool usage:
      ```
      Task("Consult {model}: {short_question_summary}", """
You have access to: Bash, Read(/tmp/*), Write(/tmp/*).

Your task: Run a long-running AI consultation (1-10 minutes) and report back with results.

**Step 1: Run consultation with timeout**
Use Bash tool to run:
timeout 15m promptcode expert --prompt-file "{absolute_path_to_PROMPT_FILE}" --model {model} --yes --output "{absolute_path_to_RESULT_FILE}" --json 2>&1

Notes:
- Replace {absolute_path_to_PROMPT_FILE} with the actual path (e.g., /tmp/expert-consultation-20251011-094021-48499.txt)
- Replace {absolute_path_to_RESULT_FILE} with the actual path (e.g., /tmp/expert-result-20251011-094021-48499.json)
- The --json flag provides structured output
- 15-minute timeout prevents runaway processes
- If timeout occurs, report "TIMEOUT" and exit

**Step 2: Verify result**
Use Bash tool:
test -s "{absolute_path_to_RESULT_FILE}" && echo "SUCCESS" || echo "FAILED"

**Step 3: Read and parse JSON result**
Use Read tool to read: {absolute_path_to_RESULT_FILE}

Parse the JSON for:
- cost.total (actual cost)
- tokens.input and tokens.output
- responseTime (in seconds)
- The main response text

**Step 4: Report back**
Return a structured report:
- Status: SUCCESS | FAILED | TIMEOUT
- Model: {model}
- Cost: $X.XX
- Tokens: X input, Y output
- Response time: X.Xs
- Summary: Brief summary of key insights (2-3 sentences)
- Result file: {absolute_path_to_RESULT_FILE}

**On failure:**
- Capture exit code
- Report error message
- Include last 50 lines of stderr if available

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
   RESULT_FILE_1="${TMP%/}/expert-{model1}-$(date +%Y%m%d-%H%M%S)-$$.json"
   RESULT_FILE_2="${TMP%/}/expert-{model2}-$(date +%Y%m%d-%H%M%S)-$$.json"
   # Add more for additional models (max 4)
   ```

   Inform the user:
   ```
   ⏳ Starting ensemble consultation with {model1}, {model2}...
      This will run in parallel. Each model may take 1-10 minutes.
      Launching autonomous Task to orchestrate...
      You can continue working - the Task will report back with synthesis and winner.
   ```

   **Invoke a parent Task that spawns parallel sub-tasks:**
   ```
   Task("Ensemble: {model1} vs {model2} on {short_question}", """
You have access to: Task, Bash, Read(/tmp/*), Write(/tmp/*).

Your task: Run parallel AI consultations with multiple models, then synthesize and declare a winner.

**Step 1: Launch parallel sub-tasks**

Spawn these Tasks in parallel (do not wait between them):

Task("Consult {model1}", '''
You have access to: Bash, Read(/tmp/*).

Run: timeout 15m promptcode expert --prompt-file "{absolute_path_to_PROMPT_FILE}" --model {model1} --yes --output "{absolute_path_to_RESULT_FILE_1}" --json 2>&1

Then:
1. Verify: test -s "{absolute_path_to_RESULT_FILE_1}"
2. Read the JSON result file
3. Return: {{status: "SUCCESS|FAILED", model: "{model1}", cost: $X.XX, tokens: "X in, Y out", time: X.Xs, file: "{absolute_path_to_RESULT_FILE_1}"}}
''')

Task("Consult {model2}", '''
You have access to: Bash, Read(/tmp/*).

Run: timeout 15m promptcode expert --prompt-file "{absolute_path_to_PROMPT_FILE}" --model {model2} --yes --output "{absolute_path_to_RESULT_FILE_2}" --json 2>&1

Then:
1. Verify: test -s "{absolute_path_to_RESULT_FILE_2}"
2. Read the JSON result file
3. Return: {{status: "SUCCESS|FAILED", model: "{model2}", cost: $X.XX, tokens: "X in, Y out", time: X.Xs, file: "{absolute_path_to_RESULT_FILE_2}"}}
''')

**Step 2: Wait for all sub-tasks to complete**
Both Tasks will run in parallel. Wait for both to report back.

**Step 3: Read all result files**
Use Read tool to read:
- {absolute_path_to_RESULT_FILE_1}
- {absolute_path_to_RESULT_FILE_2}

Parse each JSON for the actual response text, cost, tokens, and timing.

**Step 4: Create synthesis report**
Analyze both responses and create a synthesis file:

Use Write tool to create: {absolute_path_to_SYNTHESIS_FILE}

Format:
# Ensemble Expert Consultation Results

## Question
{original_question}

## Expert Responses

### {Model1} - ${actual_cost}, {response_time}s
**Key Points:**
- [Extract 3-4 main points from model1's response]

### {Model2} - ${actual_cost}, {response_time}s
**Key Points:**
- [Extract 3-4 main points from model2's response]

## Synthesis

**Consensus Points:**
- [Points where both models agree]

**Divergent Views:**
- {Model1}: [Unique perspective]
- {Model2}: [Unique perspective]

**🏆 WINNER: {winning_model}**
Reason: [Clear, specific reason why this model provided the better answer - e.g., "More thorough analysis of edge cases", "Better practical recommendations", "Deeper technical insights"]

(Or if genuinely tied: "TIE - Both provided equally valuable but complementary insights")

**Performance Summary:**
- Total Cost: ${sum_of_costs}
- {Model1}: ${cost1}, {time1}s
- {Model2}: ${cost2}, {time2}s
- Best Value: {model with best quality/cost ratio}

**Step 5: Report back**
Return to main conversation:
- Which model won and why
- Key consensus points
- Total cost and timing
- Path to synthesis file: {absolute_path_to_SYNTHESIS_FILE}
""")
   ```

   **Important**:
   - Replace all placeholder paths with actual absolute paths before invoking Task
   - The sub-tasks spawn in parallel - do not make them sequential
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
- **Default model is gpt-5** - use this unless user explicitly requests another model
- Discover default model via `promptcode expert --models --json` (look for `defaultModel: "gpt-5"`)
- For ensemble mode: limit to maximum 4 models
- NEVER automatically add --yes without user approval
- **Always use --json flag** for structured output (easier parsing, more reliable than text scraping)
- **Always use --output flag** for file output (more reliable than stdout redirection)
- **Timeout protection**: All consultations have 15-minute timeout via `timeout 15m` command
- **Task-based execution**: For long-running models (gpt-5-pro, o3-pro), use the Task tool to spawn an autonomous sub-agent
  - Pass concrete absolute file paths to Task (not shell variables like $PROMPT_FILE)
  - Explicitly state tool usage (Bash, Read, Write) in Task prompt
  - Task provides true non-blocking execution that persists across sessions
  - Task will report back when complete
- **Fast vs slow models**: Fast models (gpt-5, sonnet-4, opus-4, etc) take <30s and run in foreground. Long-running models (gpt-5-pro, o3-pro) take 1-10 minutes and should use Task tool
- **Ensemble execution**: Parent Task spawns parallel sub-tasks (one per model), waits for all, synthesizes, and declares winner
- **File paths**: Always use absolute paths in Task prompts. Result files should be .json for structured output
- Reasoning effort defaults to 'high' (set in CLI) - no need to specify