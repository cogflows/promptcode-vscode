import { promises as fs } from 'fs';
import * as path from 'path';
import { MODELS } from '../providers/models';

// Export constants that both CLI and hook need
export const APPROVAL_COST_THRESHOLD = 0.50;
export const EXPENSIVE_MODELS = ['o3-pro', 'opus-4', 'gpt-4-pro'];

// Model pricing for hook to calculate costs
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {};
Object.entries(MODELS).forEach(([key, config]) => {
  MODEL_PRICING[key] = config.pricing;
});

/**
 * Generate the cost approval hook script
 */
export function generateApprovalHook(): string {
  // Create regex pattern that handles --model=name and --model name syntax
  // Case-insensitive for model names
  const modelRegex = EXPENSIVE_MODELS.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  
  return `#!/bin/bash
# PromptCode Cost Approval Hook for Claude Code
# Auto-generated - DO NOT EDIT MANUALLY
# This hook blocks expensive expert commands that don't have approval flags

# Read the tool input from stdin
TOOL_INPUT=$(cat)

# Extract the command from the JSON input
COMMAND=$(echo "$TOOL_INPUT" | jq -r '.tool_input.command // ""')

# Check if this is a promptcode expert command without approval flags
if [[ "$COMMAND" =~ promptcode[[:space:]]+expert ]] && ! [[ "$COMMAND" =~ (--yes|--no-confirm|-y) ]]; then
    # Extract model if specified (handles --model=name and --model name syntax)
    MODEL=""
    if [[ "$COMMAND" =~ --model(=|[[:space:]]+)([^[:space:]]+) ]]; then
        MODEL="\${BASH_REMATCH[2]}"
    fi
    
    # Check if using expensive models (case-insensitive)
    MODEL_LOWER=$(echo "$MODEL" | tr '[:upper:]' '[:lower:]')
    EXPENSIVE_MODELS=(${EXPENSIVE_MODELS.map(m => `"${m}"`).join(' ')})
    
    for expensive_model in "\${EXPENSIVE_MODELS[@]}"; do
        if [[ "$MODEL_LOWER" == *"$expensive_model"* ]]; then
            # Block and tell Claude to ask user
            echo "🚫 Expensive AI model detected ($MODEL). This command requires user approval." >&2
            echo "Please ask the user: 'This will use the $MODEL model which costs more than \\$${APPROVAL_COST_THRESHOLD.toFixed(2)}. Do you want to proceed?'" >&2
            echo "If approved, re-run with --yes flag. Note: --no-confirm also works as an auto-accept mode." >&2
            exit 2
        fi
    done
    
    # For non-expensive models, try to estimate cost based on file patterns
    # This is a simplified check - if many files or wildcards detected
    if [[ "$COMMAND" =~ \\*\\*/ ]] || [[ "$COMMAND" =~ -f[[:space:]]+\"[^\"]*\\*[^\"]*\" ]]; then
        # Likely many files, could exceed threshold even with cheaper model
        echo "⚠️  Large file selection detected. This command may exceed \\$${APPROVAL_COST_THRESHOLD.toFixed(2)}." >&2
        echo "Please ask the user: 'This command may analyze many files and cost more than \\$${APPROVAL_COST_THRESHOLD.toFixed(2)}. Do you want to proceed?'" >&2
        echo "If approved, re-run with --yes flag. Note: --no-confirm also works as an auto-accept mode." >&2
        exit 2
    fi
fi

# For all other commands, allow normally
exit 0`;
}

/**
 * Write the hook to a file
 */
export async function writeApprovalHook(outputPath: string): Promise<void> {
  const hookContent = generateApprovalHook();
  await fs.writeFile(outputPath, hookContent);
  await fs.chmod(outputPath, '755');
}

// If run directly, generate the hook
if (require.main === module) {
  const outputPath = process.argv[2] || path.join(__dirname, '..', 'claude-templates', 'promptcode-cost-approval-hook.sh');
  writeApprovalHook(outputPath)
    .then(() => console.log(`Generated hook at: ${outputPath}`))
    .catch(console.error);
}