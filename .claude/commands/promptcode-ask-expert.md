---
allowed-tools: Bash(promptcode expert:*), Bash(promptcode preset:*), Bash(promptcode generate:*), Bash(open:*), Read(/tmp/*), Write(/tmp/*), Task, Bash(command -v:*), Bash(cursor:*), Bash(code:*), Bash(echo:*), Bash(cat:*), Bash(wait:*)
description: Consult AI expert for complex problems with code context - supports ensemble mode for multiple models
---

Consult an expert about: $ARGUMENTS

## Instructions:

1. Analyze the request in $ARGUMENTS:
   - Extract the main question/problem
   - Identify if code context would help (look for keywords about implementation, feature, code review, etc.)
   - Check for multiple model requests (e.g., "compare using o3 and gpt-5", "ask o3, gpt-5, and gemini")
   - Get available models dynamically: `promptcode expert --models --json` (parse the JSON for model list)
   - If 2+ models detected → use ensemble mode
   - For single model: determine preference (if user mentions "o3-pro" or "o3 pro", use o3-pro)

2. Determine code context needs:
   ```bash
   promptcode preset list
   ```
   - Check if an existing preset matches the request (e.g., "security" → look for security-related presets)
   - If no suitable preset exists, use the `/promptcode-preset-create` command:
     ```
     /promptcode-preset-create {description of what code to include based on the question}
     ```
     This will intelligently create a preset with the right patterns.
   - Verify the preset:
     ```bash
     promptcode preset info {preset-name}
     ```

3. Prepare consultation file for review:
   - Create a consultation file at `/tmp/expert-consultation-{timestamp}.md`
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
     promptcode generate --preset "{preset_name}" -o /tmp/code-context-{timestamp}.txt
     cat /tmp/code-context-{timestamp}.txt >> "/tmp/expert-consultation-{timestamp}.md"
     ```

4. Open consultation for user review:
   ```bash
   # Try cursor first, then code, then EDITOR, then fallback to cat
   if command -v cursor &> /dev/null; then
     cursor "/tmp/expert-consultation-{timestamp}.md"
   elif command -v code &> /dev/null; then
     code "/tmp/expert-consultation-{timestamp}.md"
   elif [ -n "$EDITOR" ]; then
     "$EDITOR" "/tmp/expert-consultation-{timestamp}.md"
   else
     echo "📄 Consultation file created at: /tmp/expert-consultation-{timestamp}.md"
     echo "No editor found. Please open the file manually to review."
   fi
   ```
   
5. Estimate cost and get approval:
   - Use the CLI's built-in cost estimation:
     ```bash
     promptcode expert --prompt-file "/tmp/expert-consultation-{timestamp}.md" --model <model> --estimate-cost --json
     ```
   - Parse the JSON output to get:
     - `tokens.input` - total input tokens
     - `cost.total` - estimated total cost
   - Check the exit code: 0 = success, 2 = approval required (cost > threshold)
   
   **For single model:**
   - Say: "I've prepared the expert consultation using preset '{preset_name}' (~{tokens} tokens). Model: {model}. The consultation file is open in Cursor for review. Reply 'yes' to send to the expert (estimated cost: ${cost from CLI})."
   
   **For ensemble mode (multiple models):**
   - Run --estimate-cost for each model in parallel to get costs
   - Say: "I've prepared an ensemble consultation using preset '{preset_name}' (~{tokens} tokens) with {models}. Total estimated cost: ${total_cost} ({model1}: ${cost1}, {model2}: ${cost2}, ...). The consultation file is open for review. Reply 'yes' to proceed with all models in parallel."

6. Execute based on mode:

   **Single Model Mode:**
   ```bash
   promptcode expert --prompt-file "/tmp/expert-consultation-{timestamp}.md" --model {model} --yes
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
       - Sub-task 1: promptcode expert --prompt-file '/tmp/expert-consultation-{timestamp}.md' --model {model1} --yes > /tmp/expert-{model1}-{timestamp}.txt 2>&1
       - Sub-task 2: promptcode expert --prompt-file '/tmp/expert-consultation-{timestamp}.md' --model {model2} --yes > /tmp/expert-{model2}-{timestamp}.txt 2>&1
       
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
   - Create synthesis report in `/tmp/expert-ensemble-synthesis-{timestamp}.md`:
   
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
- **Create presets intelligently** - analyze the question to determine which files are relevant
- **Show the preset name** to the user so they know what context is being used
- Default to GPT-5 model unless another model is explicitly requested
- For ensemble mode: limit to maximum 4 models to prevent resource exhaustion
- Always show cost estimate before sending
- Keep questions clear and specific
- Include relevant code context when asking about specific functionality
- NEVER automatically add --yes/--force without user approval
- Only ask for approval ONCE before sending to expert (not for preparatory steps)
- Reasoning effort defaults to 'high' (set in CLI) - no need to specify
- Use `promptcode generate -o` to avoid stdout redirection issues