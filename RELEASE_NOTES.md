# PromptCode CLI v0.1.0 Release

## 🎉 Highlights

This release introduces a **zero-friction AI-agent friendly interface** that makes PromptCode instantly usable by AI coding assistants without any learning curve.

## 📦 Distribution

### macOS (Apple Silicon)
- **File**: `promptcode-cli-v0.1.0-macos-arm64.tar.gz`
- **Size**: 22MB
- **SHA256**: `bb2eae5df8aac5818e871c2e88eec3fc0309d28084b02ac4ab6837b88b443b12`

### Installation
```bash
# Download and extract
tar -xzf promptcode-cli-v0.1.0-macos-arm64.tar.gz
cd promptcode-cli-v0.1.0-macos-arm64

# Run installer
./install.sh

# Or manual install
chmod +x promptcode
sudo mv promptcode /usr/local/bin/
```

## 🚀 New Features

### AI-Agent Friendly Interface
```bash
# Just works - no configuration needed
promptcode "Why is this slow?" src/**/*.ts
promptcode "Explain the auth flow" @backend/ @frontend/
```

### Reproducibility
```bash
# Save patterns for later
promptcode "Find bugs" src/**/*.ts --save-preset bug-hunt

# View history
promptcode history

# Convert history to preset
promptcode history --preset 0 my-analysis
```

## 🔧 Technical Details

- **Runtime**: Standalone binary (no dependencies)
- **Size**: 61MB uncompressed
- **Platform**: macOS ARM64 (Apple Silicon)
- **Version**: 0.1.0

## 📝 Full Changelog

See [CHANGELOG.md](dist/cli-release/CHANGELOG.md) for detailed changes.

## 🤝 Contributing

This is part of the PromptCode VS Code extension project. Contributions welcome!

## 📄 License

[Your License Here]