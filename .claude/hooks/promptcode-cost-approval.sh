#!/bin/bash
# PromptCode Cost Approval Hook for Claude Code
# This simple hook blocks expensive expert commands that don't have --yes flag

# Read the tool input from stdin
TOOL_INPUT=$(cat)

# Extract the command from the JSON input
COMMAND=$(echo "$TOOL_INPUT" | jq -r '.tool_input.command // ""')

# Check if this is a promptcode expert command without --yes
if [[ "$COMMAND" =~ promptcode[[:space:]]+expert ]] && ! [[ "$COMMAND" =~ (--yes|--no-confirm|-y) ]]; then
    # Check if using expensive models
    if [[ "$COMMAND" =~ --model[[:space:]]+(o3-pro|opus-4|gpt-4-pro) ]] || [[ "$COMMAND" =~ o3-pro|opus-4 ]]; then
        # Block and tell Claude to ask user
        echo "🚫 Expensive AI model detected. This command requires user approval. Please ask the user: 'This will use an expensive AI model. Do you want to proceed?' If approved, re-run with --yes flag." >&2
        exit 2
    fi
fi

# For all other commands, allow normally
exit 0