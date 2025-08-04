# AI-Agent Friendly CLI Improvements

## Summary
Based on o3-pro's expert recommendations, we've transformed the PromptCode CLI from a traditional command-based interface to a zero-friction tool that AI agents can use intuitively without documentation.

## Key Changes

### 1. Zero-Friction Syntax
**Before:** AI agents had to learn multiple commands and create presets
```bash
promptcode preset --create temp
# Edit .promptcode/presets/temp.patterns
promptcode expert "question" --preset temp
```

**After:** Natural, intuitive syntax
```bash
promptcode "Why is this slow?" src/**/*.ts
promptcode "Explain the auth flow" @backend/ @api/
promptcode src/**/*.ts  # Just generate prompt
```

### 2. Smart Command Detection
- Added `parsePositional()` function that intelligently detects:
  - Questions (strings with spaces or ending with ?)
  - File patterns (paths, globs, existing files)
  - @ prefix support (Gemini-style familiarity)

### 3. Improved Error Messages
- Replaced generic errors with helpful examples
- Guide AI agents to correct syntax
- Show tips when files aren't found

### 4. Implementation Details

#### Modified Files:
1. **packages/cli/src/index.ts**
   - Added smart routing logic before command parsing
   - Implemented `parsePositional()` and `defaultCommand()` functions
   - Updated help text to showcase AI-friendly syntax

2. **packages/cli/src/commands/expert.ts**
   - Enhanced file pattern handling (direct files > preset > default)
   - Added @ prefix stripping
   - Improved error messages with examples

## Testing Results
All scenarios work as expected:
- ✅ Question + files: `promptcode "Why is this slow?" file.ts`
- ✅ @ prefix support: `promptcode "Explain this" @src/`
- ✅ Files only: `promptcode src/**/*.ts`
- ✅ Full project: `promptcode "What patterns are used?"`
- ✅ Traditional commands still work

## Impact
- AI agents can now use promptcode with zero learning curve
- Maintains full backward compatibility
- Follows KISS principle as recommended by o3-pro
- Reduces friction from ~5 steps to 1 step