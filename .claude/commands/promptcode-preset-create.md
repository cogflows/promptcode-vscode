---
allowed-tools: Bash(promptcode preset create:*), Bash(promptcode preset info:*), Glob(**/*), Grep, Write(.promptcode/presets/*.patterns)
description: Create a promptcode preset from description
---

Create a promptcode preset for: $ARGUMENTS

## Instructions:

1. Parse the description to understand what code to capture:
   - Look for keywords like package names, features, components, integrations
   - Identify if it's Python, TypeScript, or mixed code
   - Determine the scope (single package, cross-package feature, etc.)

2. Research the codebase structure:
   - Use Glob to explore relevant directories
   - Use Grep to find related files if needed
   - Identify the main code locations and any related tests/docs

3. Generate a descriptive preset name:
   - Use kebab-case (e.g., "auth-system", "microlearning-utils")
   - Keep it concise but descriptive

4. Create the preset (automatically optimized from concrete files):
   ```bash
   # When you identify specific files, always use --from-files for smart optimization
   promptcode preset create "{preset_name}" --from-files {file-globs...}
   # default optimization-level is "balanced"
   # to control: --optimization-level minimal|balanced|aggressive
   ```
   This creates `.promptcode/presets/{preset_name}.patterns` with optimized patterns.

5. Edit the preset file to add patterns (if needed):
   - Start with a header comment explaining what the preset captures
   - Add inclusion patterns for the main code
   - Add patterns for related tests and documentation
   - Include common exclusion patterns:
     - `!**/__pycache__/**`
     - `!**/*.pyc`
     - `!**/node_modules/**`
     - `!**/dist/**`
     - `!**/build/**`

6. Test and report results:
   ```bash
   promptcode preset info "{preset_name}"
   ```
   Report the file count and estimated tokens.

## Common Pattern Examples:
- Python package: `python/cogflows-py/packages/{package}/src/**/*.py`
- TypeScript component: `ts/next/{site}/components/{component}/**/*.{ts,tsx}`
- Cross-package feature: Multiple specific paths
- Tests: `python/cogflows-py/packages/{package}/tests/**/*.py`
- Documentation: `**/{feature}/**/*.md`