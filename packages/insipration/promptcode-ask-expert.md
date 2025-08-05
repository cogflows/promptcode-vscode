---
allowed-tools: Bash(uv run --project .claude/helpers/promptcode promptcode-prepare-consultation:*), Bash(uv run --project .claude/helpers/promptcode promptcode-list:*), Bash(uv run --project .claude/helpers/promptcode --extra expert promptcode-ask-expert:*), Bash(open -a Cursor:*), Read(/tmp/expert-*:*)
description: Consult OpenAI o3 expert for complex problems
---
Consult an expert about: $ARGUMENTS

Instructions:
1. Analyze the request in $ARGUMENTS to:
   - Extract the main question/problem
   - Identify if any code context would help (look for keywords matching our presets)
   
2. If code context needed, list available presets:
   ```bash
   uv run --project .claude/helpers/promptcode promptcode-list
   ```

3. Prepare consultation using promptcode command:
   ```bash
   uv run --project .claude/helpers/promptcode promptcode-prepare-consultation "YOUR_CLEAR_QUESTION" ["PRESET_NAME"] [--model auto|o3|o3-pro]
   ```
   The command outputs: filepath|tokens|cost|model
   Note: If question contains "o3-pro" or "o3 pro", it will automatically use o3-pro ($20/$80 per million tokens) instead of o3 ($2/$8)

4. Parse the output to get filepath, tokens, cost estimate, and model

5. Open consultation: `open -a Cursor {filepath}`

6. Say: "I've prepared the expert consultation in Cursor (~{tokens} tokens estimated from file size). Model: {model}. Review it and reply 'yes' to send to the expert (estimated cost: ${cost})"

7. On user approval:
   ```bash
   uv run --project .claude/helpers/promptcode --extra expert promptcode-ask-expert --consultation-file {filepath} --model {model} --no-confirm
   ```
   Note: The --model flag can be auto|o3|o3-pro. Use the same model detected during preparation.

8. Handle the response:
   - If successful: Open response file in Cursor and summarize insights
   - If error occurs: 
     - DO NOT attempt alternative solutions or workarounds
     - Report the exact error message to the user
     - If OPENAI_API_KEY is missing, tell the user:
       ```
       To use expert consultation, you need to set up your OpenAI API key:
       1. Create a file: .claude/.env
       2. Add: OPENAI_API_KEY=your-actual-api-key
       3. Get your key from: https://platform.openai.com/api-keys
       ```
     - For other errors, ask the user how they'd like to proceed
   
IMPORTANT: Never try to run the script from different directories or with different paths when errors occur. Always report issues to the user for guidance.