---
allowed-tools: Bash(promptcode expert:*), Bash(promptcode preset list:*), Bash(promptcode generate:*), Bash(open -a Cursor:*), Read(/tmp/expert-*:*), Write(/tmp/expert-consultation-*.md), Task
description: Consult AI expert (O3/O3-pro) for complex problems with code context - supports ensemble mode for multiple models
---

Consult an expert about: $ARGUMENTS

## Instructions:

1. Analyze the request in $ARGUMENTS:
   - Extract the main question/problem
   - Identify if code context would help (look for keywords matching our presets)
   - Check for multiple model requests (e.g., "compare using o3 and gpt-5", "ask o3, gpt-5, and gemini")
   - Available models from our MODELS list: o3, o3-pro, o3-mini, gpt-5, gpt-5-mini, gpt-5-nano, sonnet-4, opus-4, gemini-2.5-pro, gemini-2.5-flash, grok-4
   - If 2+ models detected → use ensemble mode
   - For single model: determine preference (if user mentions "o3-pro" or "o3 pro", use o3-pro)

2. If code context needed, list available presets:
   ```bash
   promptcode preset list
   ```
   Choose relevant preset(s) based on the question.

3. Prepare consultation file for review:
   - Create a consultation file at `/tmp/expert-consultation-{timestamp}.md`
   - Structure the file with:
     ```markdown
     # Expert Consultation
     
     ## Question
     {user's question}
     
     ## Context
     {any relevant context or background}
     ```
   - If a preset would help, append the code context:
     ```bash
     echo -e "\n## Code Context\n" >> "/tmp/expert-consultation-{timestamp}.md"
     promptcode generate --preset "{preset_name}" >> "/tmp/expert-consultation-{timestamp}.md"
     ```

4. Open consultation for user review (if Cursor is available):
   ```bash
   open -a Cursor "/tmp/expert-consultation-{timestamp}.md"
   ```
   
5. Estimate cost and get approval:
   - Model costs (from our pricing):
     - O3: $2/$8 per million tokens (input/output)
     - O3-pro: $20/$80 per million tokens (input/output)
     - GPT-5: $1.25/$10 per million tokens
     - GPT-5-mini: $0.25/$2 per million tokens
     - Sonnet-4: $5/$20 per million tokens
     - Opus-4: $25/$100 per million tokens
     - Gemini-2.5-pro: $3/$12 per million tokens
     - Grok-4: $5/$15 per million tokens
   - Calculate based on file size (roughly: file_size_bytes / 4 = tokens)
   
   **For single model:**
   - Say: "I've prepared the expert consultation (~{tokens} tokens). Model: {model}. You can edit the file to refine your question. Reply 'yes' to send to the expert (estimated cost: ${cost})."
   
   **For ensemble mode (multiple models):**
   - Calculate total cost across all models
   - Say: "I've prepared an ensemble consultation (~{tokens} tokens) with {models}. Total estimated cost: ${total_cost} ({model1}: ${cost1}, {model2}: ${cost2}, ...). Reply 'yes' to proceed with all models in parallel."

6. Execute based on mode:

   **Single Model Mode:**
   ```bash
   promptcode expert --prompt-file "/tmp/expert-consultation-{timestamp}.md" --model {model} --yes
   ```
   
   **Ensemble Mode (Parallel Execution):**
   - Use Task tool to run multiple models in parallel
   - Each task runs the same consultation file with different models
   - Store each result in separate file: `/tmp/expert-{model}-{timestamp}.txt`
   - Example for 3 models (run these in PARALLEL using Task tool):
     ```
     Task 1: promptcode expert --prompt-file "/tmp/expert-consultation-{timestamp}.md" --model o3 --yes > /tmp/expert-o3-{timestamp}.txt
     Task 2: promptcode expert --prompt-file "/tmp/expert-consultation-{timestamp}.md" --model gpt-5 --yes > /tmp/expert-gpt5-{timestamp}.txt  
     Task 3: promptcode expert --prompt-file "/tmp/expert-consultation-{timestamp}.md" --model gemini-2.5-pro --yes > /tmp/expert-gemini-{timestamp}.txt
     ```
   - IMPORTANT: Launch all tasks at once for true parallel execution
   - Wait for all tasks to complete
   - Note: The --yes flag confirms we have user approval for the cost

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
- Default to GPT-5 model unless another model is explicitly requested
- For ensemble mode: limit to maximum 4 models to prevent resource exhaustion
- Always show cost estimate before sending
- Keep questions clear and specific
- Include relevant code context when asking about specific functionality
- NEVER automatically add --yes without user approval
- Reasoning effort defaults to 'high' (set in CLI) - no need to specify