# PromptCode Installation Guide

This guide covers installation for both the VS Code extension and the CLI tool.

## VS Code Extension

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Cmd+Shift+X / Ctrl+Shift+X)
3. Search for "PromptCode"
4. Click Install

### From Source
```bash
git clone https://github.com/cogflows/promptcode-vscode.git
cd promptcode-vscode
npm install
npm run compile
```

Then in VS Code:
- Press F5 to launch a new Extension Development Host
- The extension will be available in the new window

## CLI Tool

### Quick Install (Recommended)
```bash
# Navigate to the CLI package
cd packages/cli

# Run the installation script
./install.sh
```

This will:
- Install dependencies via Bun
- Build the CLI
- Create a symlink in ~/.local/bin
- Make it available as `promptcode` command

### Manual Installation
```bash
# Install Bun if not already installed
curl -fsSL https://bun.sh/install | bash

# Clone and build
git clone https://github.com/cogflows/promptcode-vscode.git
cd promptcode-vscode/packages/cli
bun install
bun run build

# Link globally
bun link
```

### NPM Installation (Coming Soon)
```bash
npm install -g promptcode-cli
```

## Post-Installation Setup

### 1. Create Your First Preset
```bash
# Create a preset for your project
promptcode preset --create my-project

# Edit the preset to include your files
promptcode preset --edit my-project
```

### 2. Set Up AI Expert (Optional)
```bash
# Configure OpenAI API key for expert consultation
promptcode config --set-openai-key sk-your-api-key
```

### 3. Verify Installation
```bash
# Check CLI is working
promptcode --help

# Generate a test prompt
promptcode generate -f "*.md" -o test.md
```

## Directory Structure

After installation, PromptCode uses these directories:

```
~/.config/promptcode/       # Configuration
├── config.json            # API keys and settings
└── prompts/              # Custom templates

~/.cache/promptcode/        # Token count cache

.promptcode/               # Project-specific (in your project)
├── presets/              # Pattern presets
│   └── *.patterns       # Preset files
├── outputs/             # Generated prompts
└── context.json         # Current context
```

## Troubleshooting

### Command Not Found
```bash
# Add to your shell config (.bashrc, .zshrc, etc.)
export PATH="$HOME/.local/bin:$PATH"
```

### Permission Denied
```bash
chmod +x ~/.local/bin/promptcode
```

### Bun Not Found
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
```

## Updating

### VS Code Extension
- Updates automatically through VS Code
- Or manually check for updates in Extensions panel

### CLI Tool
```bash
cd packages/cli
git pull
bun install
bun run build
```

## Uninstalling

### VS Code Extension
- Right-click on PromptCode in Extensions panel
- Select Uninstall

### CLI Tool
```bash
# Remove symlink
rm ~/.local/bin/promptcode

# Remove config and cache (optional)
rm -rf ~/.config/promptcode
rm -rf ~/.cache/promptcode
```