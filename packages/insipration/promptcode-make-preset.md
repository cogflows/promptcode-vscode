Create a promptcode preset for: $ARGUMENTS

Instructions:
1. Parse the description to understand what code to capture
   - Look for keywords like package names, features, components, integrations
   - Identify if it's Python, TypeScript, or mixed code
   - Determine the scope (single package, cross-package feature, etc.)

2. Research the codebase structure
   - Use Glob to explore relevant directories
   - Use Grep to find related files if needed
   - Identify the main code locations and any related tests/docs

3. Create the preset pattern file
   - Generate a descriptive filename in kebab-case (e.g., "microlearning-utils.patterns")
   - Write to `/.promptcode/presets/` directory
   - Include a header comment explaining what the preset captures

4. Write appropriate patterns
   - Start with broad inclusion patterns for the main code
   - Add patterns for related tests and documentation
   - Include common exclusion patterns:
     - `!**/__pycache__/**`
     - `!**/*.pyc`
     - `!**/*.pyo`
     - `!**/node_modules/**`
     - `!**/dist/**`
     - `!**/build/**`

5. Test and report results
   - Use `list_files_by_patterns_file` to verify the patterns work
   - Count the matched files
   - Estimate total tokens using `estimate_prompt_tokens`
   - Report: "Created preset '{name}' capturing {count} files (~{tokens:,} tokens)"

Common patterns to consider:
- Python package: `python/cogflows-py/packages/{package}/src/**/*.py`
- TypeScript component: `ts/next/{site}/components/{component}/**/*.{ts,tsx}`
- Cross-package feature: Multiple specific paths
- Tests: `python/cogflows-py/packages/{package}/tests/**/*.py`
- Documentation: `**/{feature}/**/*.md`

Example: If asked for "functional programming utilities", create a preset that includes:
- The functional package source code
- Related tests
- Documentation files
- Appropriate exclusions