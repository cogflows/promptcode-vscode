# PromptCode CLI Review Request

## Context
We're building a CLI tool for AI agents (like Claude) to interact with codebases more effectively. The goal is to make the CLI itself AI-friendly so agents can use it directly, while providing minimal Claude-specific extensions only where truly needed.

## Inspiration Files Analysis
We reviewed these Claude-specific command files from a friend's implementation:

### 1. **promptcode-ask-expert.md**
- Complex o3/o3-pro consultation workflow
- Includes cost estimation, model selection
- File preparation and response handling
- Confirmation flows for expensive operations

### 2. **promptcode-info.md** 
- Shows preset details with token counts
- Can infer preset from description
- Displays file statistics and patterns

### 3. **promptcode-list.md**
- Lists available presets
- Shows descriptions and stats

### 4. **promptcode-make-preset.md**
- Guides AI through creating presets
- Helps with pattern writing
- Tests and validates presets

### 5. **promptcode-preset-to-output.md**
- Generates output from presets
- Smart inference from descriptions
- Flexible output path handling

## Our Implementation Decisions

### Core CLI (Direct Commands)
We decided most functionality belongs in the CLI itself:
- `promptcode preset list` - Lists presets
- `promptcode preset info <name>` - Shows preset details  
- `promptcode preset create <name>` - Creates preset
- `promptcode generate -l <preset>` - Uses preset
- `promptcode expert "question"` - Ask AI with context

### Claude Integration (`promptcode cc`)
Created minimal `.claude` folder structure:
```
.claude/
├── CLAUDE.md          # Usage instructions for AI agents
├── .env.example       # API key template
├── .gitignore         # Git ignore rules
└── commands/          # Claude-specific commands
    └── expert-consultation.md  # Only complex o3/o3-pro workflow
```

### Key Design Principles
1. **CLI should be AI-friendly by default** - Clear commands, good help text
2. **Avoid wrapper commands** - Don't create .claude commands that just call CLI
3. **Only add Claude-specific for complex workflows** - Like o3/o3-pro consultation
4. **Teach through documentation** - CLAUDE.md shows how to use CLI effectively

### CLAUDE.md Template Content
Focuses on teaching AI agents:
- Common workflows and patterns
- How to discover and use presets
- Best practices for token management
- Direct CLI command examples

### Safety Features Added
- `.claude` folder discovery checks parent dir (monorepo support)
- Won't create duplicate folders
- Confirmation prompts for destructive operations
- `--force` means update, not recreate
- Clear warnings about what will be deleted

## Questions for Review

1. **Minimalism vs Power**: Have we struck the right balance? We kept only the expert consultation as a .claude command since it has complex approval flows. Should we add any others?

2. **Approval Workflows**: The inspiration files show approval patterns (cost estimation, confirmation). Should we add more approval hooks to the core CLI commands?

3. **Preset Discovery**: Should we add more AI-friendly preset discovery to the CLI? Like `promptcode preset find "auth related"`?

4. **Missing Features**: Are there powerful patterns from the inspiration we missed?

5. **CLAUDE.md Content**: Is our documentation approach sufficient for teaching AI agents?

6. **Command Structure**: Is `promptcode preset info <name>` better than the original `--info` flag approach?

Please review our implementation and suggest improvements, especially around:
- Maintaining minimalism while capturing the power of the inspiration
- Approval/confirmation workflows we might need
- Any critical features we overlooked
- Ways to make the CLI even more AI-friendly