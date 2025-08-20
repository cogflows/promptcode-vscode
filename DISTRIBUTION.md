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
- CLI: 0.1.0 (shows as 0.1.0-dev.YYYYMMDD.hash in dev builds)
- Core: 0.1.0

### Version Display
Development builds show extended version info:
```bash
$ ./packages/cli/dist/promptcode --version
0.1.0-dev.20250803.fd95714

$ ./packages/cli/dist/promptcode version-info
PromptCode CLI
──────────────────────────────────────────────────
Version: 0.1.0-dev.20250803.fd95714
Build type: Development
Build date: 2025-08-03
Git commit: fd95714
Node.js: v24.3.0
Platform: darwin arm64
```

## Recent Changes
- Fixed token counting showing 0 for all AI models
- Added comprehensive unit tests
- Improved type safety with TypeScript
- Added support for multiple AI SDK token formats
- Documented pricing conventions

## Release Process

### Build and Stage (Automatic)
When you push a tag, GitHub Actions automatically:
1. Builds all artifacts (CLI binaries, VS Code extension VSIX)
2. Creates a GitHub Release with all artifacts
3. Does NOT mark as "latest" (manual control)

### Promote to Users (Manual)

#### VS Code Extension
```bash
# Publish specific version to marketplace
gh workflow run publish-extension.yml -f tag=v0.7.0
```

#### CLI Auto-Updates
```bash
# Enable auto-updates for specific version
gh workflow run promote-cli.yml -f tag=v0.7.0
```

#### Both Products
```bash
# Promote both CLI and extension
gh workflow run promote-all.yml -f tag=v0.7.0
```

### Quick Release Workflow
```bash
# 1. Update version
npm version patch  # or minor/major

# 2. Push tag
git push origin main --tags

# 3. Wait for build, then test artifacts

# 4. If good, promote
gh workflow run promote-all.yml -f tag=v0.7.0

# 5. If bad, increment and try again
npm version patch
git push origin main --tags
```

### Publish Core Package to npm (if needed)
```bash
cd packages/core
npm publish --access public
```

## Testing Distribution
```bash
# Test CLI
./packages/cli/dist/promptcode --version
./packages/cli/dist/promptcode expert --list-models

# Verify builds
ls -la out/
ls -la packages/*/dist/
```