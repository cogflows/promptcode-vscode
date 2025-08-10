---
allowed-tools: Bash(promptcode expert:*), Bash(promptcode preset list:*), Bash(promptcode generate:*), Bash(open -a Cursor:*), Read(/tmp/expert-*:*), Write(/tmp/expert-consultation-*.md)
description: Consult AI expert (O3/O3-pro) for complex problems with code context
---

Consult an expert about: $ARGUMENTS

## Instructions:

1. Analyze the request in $ARGUMENTS:
   - Extract the main question/problem
   - Identify if code context would help (look for keywords matching our presets)
   - Determine model preference (if user mentions "o3-pro" or "o3 pro", use o3-pro)

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
   - Model costs:
     - O3: $2/$8 per million tokens (input/output)
     - O3-pro: $20/$80 per million tokens (input/output)
   - Calculate based on file size (roughly: file_size_bytes / 4 = tokens)
   - Say: "I've prepared the expert consultation (~{tokens} tokens). Model: {model}. You can edit the file to refine your question. Reply 'yes' to send to the expert (estimated cost: ${cost})."

6. On user approval, send to expert using the prompt file:
   ```bash
   promptcode expert --prompt-file "/tmp/expert-consultation-{timestamp}.md" --model {model} --yes
   ```
   
   Note: The --yes flag confirms we have user approval for the cost.
   The --prompt-file approach allows the user to edit the consultation before sending.

7. Handle the response:
   - If successful: Open response in Cursor (if available) and summarize key insights
   - If OPENAI_API_KEY missing:
     ```
     To use expert consultation, set your OpenAI API key:
     export OPENAI_API_KEY=sk-...
     Get your key from: https://platform.openai.com/api-keys
     ```
   - For other errors: Report exact error message

## Important:
- Default to O3 model unless O3-pro explicitly requested or needed for complex reasoning
- Always show cost estimate before sending
- Keep questions clear and specific
- Include relevant code context when asking about specific functionality
- NEVER automatically add --yes without user approval