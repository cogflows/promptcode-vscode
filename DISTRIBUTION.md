# PromptCode Distribution Summary

## Build Artifacts

### 1. VS Code Extension (v0.3.2)
- **Location**: `out/` directory
- **Size**: 3.8 MB
- **Main file**: `out/extension.js`
- **Ready for**: Publishing to VS Code Marketplace with `vsce publish`

### 2. CLI Tool (v0.1.0)
- **Location**: `packages/cli/dist/promptcode`
- **Size**: 61 MB (standalone Bun binary)
- **Platform**: macOS ARM64
- **Features**: 
  - Token counting and cost calculation (fixed)
  - Expert AI consultation with multiple models
  - File watching and diff capabilities
  - Preset management

### 3. Core Library (v0.1.0)
- **Location**: `packages/core/dist/`
- **Size**: 88 KB
- **Type**: TypeScript library with type definitions
- **Ready for**: Publishing to npm registry

## Version Information
- VS Code Extension: 0.3.2
- CLI: 0.1.0 
- Core: 0.1.0

## Recent Changes
- Fixed token counting showing 0 for all AI models
- Added comprehensive unit tests
- Improved type safety with TypeScript
- Added support for multiple AI SDK token formats
- Documented pricing conventions

## Distribution Commands

### Publish VS Code Extension
```bash
cd <project-root>
vsce publish
```

### Publish Core Package to npm
```bash
cd packages/core
npm publish --access public
```

### Distribute CLI Binary
- Upload to GitHub Releases
- Consider creating install script for different platforms
- Build for other platforms: `bun build src/index.ts --compile --target=bun-linux-x64`

## Testing Distribution
```bash
# Test CLI
./packages/cli/dist/promptcode --version
./packages/cli/dist/promptcode expert --list-models

# Verify builds
ls -la out/
ls -la packages/*/dist/
```