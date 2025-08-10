# PromptCode CLI Hook-Based Approval Architecture

## Overview

The PromptCode CLI implements a multi-layered approval system for expensive AI operations, designed to work seamlessly with AI coding agents like Claude Code.

## Architecture Layers

### 1. CLI Layer (Built-in Protection)
- **Location**: `src/commands/expert.ts`
- **Responsibility**: Cost calculation and approval logic
- **Features**:
  - Calculates token costs based on model pricing
  - Checks if cost > $0.50 or using "pro" models
  - In interactive terminals: Shows prompt and waits for user input
  - In non-interactive environments: Exits with error message
  - Honors `--yes` and `--no-confirm` flags

### 2. Documentation Layer (AI Agent Instructions)
- **Location**: `CLAUDE.md` template
- **Responsibility**: Instructs AI agents on proper behavior
- **Features**:
  - Clear "AI Agent Approval Protocol"
  - Step-by-step instructions for handling approval requests
  - Emphasis on NEVER auto-approving expensive operations

### 3. Hook Layer (External Enforcement)
- **Location**: `.claude/hooks/promptcode-cost-approval.sh`
- **Responsibility**: Intercepts commands before execution
- **Features**:
  - PreToolUse hook that runs before Bash commands
  - Detects `promptcode expert` with expensive models
  - Blocks execution if no `--yes` flag present
  - Returns clear message for AI agent to handle

### 4. Command Layer (AI Agent Behavior)
- **Location**: `.claude/commands/expert-consultation.md`
- **Responsibility**: Guides AI agent behavior
- **Features**:
  - Reminds about approval requirements
  - Provides clear instructions on handling denials

## Boundaries & Interactions

```
User Request
    ↓
AI Agent (Claude Code)
    ↓
PreToolUse Hook → Blocks if expensive & no --yes
    ↓
CLI Execution → Additional check & clear error message
    ↓
AI Agent Response → Asks user for approval
    ↓
User Approval
    ↓
Re-run with --yes → Hook allows → CLI executes
```

## Key Design Decisions

### 1. Why PreToolUse Hook?
- Can prevent execution before it happens
- Simple pattern matching on commands
- Clear blocking with exit code 2

### 2. Why Not Parse Command Complexity?
- Keeps hook simple and maintainable
- CLI already has sophisticated cost logic
- Avoids duplication and drift

### 3. Multi-Layer Defense
- Hook: First line of defense (pattern matching)
- CLI: Second line with accurate cost calculation
- Documentation: Ensures AI agents behave correctly

## Installation Flow

When users run `promptcode cc`:

1. Updates `CLAUDE.md` with approval instructions
2. Installs `.claude/commands/expert-consultation.md`
3. Installs `.claude/hooks/promptcode-cost-approval.sh`
4. Updates `.claude/settings.json` to register hook
5. Makes hook executable (chmod 755)

## Uninstall Flow

When users run `promptcode cc --uninstall`:

1. Removes PromptCode section from `CLAUDE.md`
2. Removes expert command
3. Removes cost approval hook
4. Cleans up hook configuration from settings.json
5. Removes empty directories

## Configuration Example

`.claude/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/promptcode-cost-approval.sh"
          }
        ]
      }
    ]
  }
}
```

## Security Considerations

1. **Hook Safety**: Hook only blocks, never modifies commands
2. **Clear Messaging**: Users always know why approval is needed
3. **Explicit Consent**: Requires deliberate `--yes` flag
4. **No Auto-Approval**: AI agents instructed to never bypass

## Future Enhancements

1. **Configurable Thresholds**: Allow users to set custom cost limits
2. **Model Allowlist**: Let users pre-approve certain models
3. **Project-Specific Rules**: Different approval rules per project
4. **Audit Logging**: Track all approval requests and decisions