---
allowed-tools: Bash(promptcode expert:*), Bash(promptcode preset:*), Bash(open -a Cursor:*), Read(/tmp/expert-*:*)
description: Consult OpenAI o3/o3-pro expert for complex problems with code context
---
Consult an expert about: $ARGUMENTS

Instructions:
1. Analyze the request in $ARGUMENTS to understand:
   - The main question/problem
   - Whether code context would help

2. If code context would be helpful:
   ```bash
   promptcode preset list  # See available presets
   ```
   
   Choose relevant preset(s) or create specific file patterns.

3. Ask the expert with appropriate context:
   ```bash
   # With preset:
   promptcode expert "YOUR_CLEAR_QUESTION" --preset <preset-name> --model <model>
   
   # With specific files:
   promptcode expert "YOUR_CLEAR_QUESTION" -f "src/**/*.ts" --model <model>
   
   # Without context (general question):
   promptcode expert "YOUR_CLEAR_QUESTION" --model <model>
   ```
   
   The CLI will show estimated cost and ask for confirmation if:
   - Cost exceeds $0.50
   - Using a "pro" model
   
   IMPORTANT: If you see "Non-interactive environment detected":
   - DO NOT automatically add --yes or --no-confirm
   - STOP and inform the user about the cost
   - Ask: "This will cost approximately $X.XX. Do you want to proceed?"
   - Only proceed with --yes after user explicitly approves
   
   Model options:
   - `o3` - Standard O3 model ($2/$8 per million tokens)
   - `o3-pro` - O3 Pro for complex tasks ($20/$80 per million tokens)
   - If question mentions "o3-pro" or "o3 pro", use `--model o3-pro`
   - Otherwise default to `--model o3`

4. If output file was specified, open it:
   ```bash
   promptcode expert "..." --output response.md
   open -a Cursor response.md  # or read the file
   ```

5. Parse the response:
   - If successful: Summarize key insights
   - If API key missing: Tell user to run:
     ```bash
     promptcode config --set-openai-key sk-...
     # Or set OPENAI_API_KEY environment variable
     ```
   - For other errors: Report exact error message

IMPORTANT: 
- Always include relevant code context when asking about specific functionality
- Be clear and specific in your questions
- Choose o3-pro only for genuinely complex tasks requiring deep reasoning