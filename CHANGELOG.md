# Changelog

All notable changes to this project will be documented in this file.

## [0.9.0] - 2025-11-19

### Added
- **Gemini 3 Support**: Full support for Gemini 3 Pro with `thinkingLevel` parameter mapping
  - Maps reasoning effort (none/minimal/low → 'low', medium → 'medium', high → 'high')
  - Automatically sets temperature to 1.0 (Google's recommendation for optimal reasoning)
  - Proper timeout handling for extended thinking operations

### Changed
- Updated @ai-sdk/google to 3.0.0-beta.50 for thinkingConfig support

### Fixed
- Flaky E2E installer test now properly isolated from system PATH

## [0.7.0] - 2025-11-18

### Added
- Background execution for long-running AI models (o3-pro, GPT-5 Pro)
- User-scope installation for Claude Code and Cursor integrations
- New environment variables: `PROMPTCODE_FORCE_BACKGROUND`, `PROMPTCODE_DISABLE_BACKGROUND`, `PROMPTCODE_FALLBACK_BACKGROUND`

### Fixed
- Timeout handling for extended AI model requests

### Changed
- CLI version bumped to 0.8.8 with CI stability improvements

## [0.5.2] - 2025-08-13

### Fixed
- Critical search functionality in VS Code extension
- File selection state management issues
- Core package integration bugs

## [0.5.1] - 2025-08-12

### Added
- **Cursor IDE Integration**: New `promptcode cursor` command creates `.cursor/rules/*.mdc` files for Cursor IDE integration
- **Enhanced CLI Documentation**: Added 8 new comprehensive example sections covering real-world use cases
- **Shared Integration Utilities**: New helper module for managing AI agent integrations (Claude Code, Cursor, etc.)

### Fixed
- Documentation URLs now correctly reference `main` branch instead of feature branches
- Markdown formatting issues resolved across all documentation files
- Security: Added path validation for git command execution to prevent injection attacks

### Breaking Changes
- **CLI Parsing**: Commands must now be explicitly specified. Previously `promptcode "question"` would implicitly run the expert command, now you must use `promptcode expert "question"`. This change improves clarity and prevents ambiguous command interpretation.

## [0.3.3] - 2025-08-07

### Added
- PromptCode CLI - Standalone command-line interface for generating AI-ready prompts
  - Zero-friction syntax: `promptcode "Why is this slow?" src/**/*.ts`
  - Preset management for reusable file patterns
  - Expert mode for AI consultation with OpenAI, Anthropic, Google, and xAI models
  - Token counting and cost estimation
  - Built with Bun for fast compilation and distribution

## [0.3.2] - Previous releases

See commit history for details.