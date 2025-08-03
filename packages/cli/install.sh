#!/bin/bash

# PromptCode CLI Installation Script

set -e

echo "Installing PromptCode CLI..."

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "Bun is not installed. Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    
    # Add bun to PATH for this session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    
    # Verify installation
    if ! command -v bun &> /dev/null; then
        echo "Error: Failed to install Bun. Please install manually:"
        echo "curl -fsSL https://bun.sh/install | bash"
        exit 1
    fi
    
    echo "✅ Bun installed successfully!"
fi

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Install dependencies
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
bun install

# Build the CLI
echo "Building CLI..."
bun run build

# Make the CLI executable
chmod +x "$SCRIPT_DIR/dist/promptcode"

# Create symlink in user's local bin
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

# Remove old symlink if exists
rm -f "$LOCAL_BIN/promptcode"

# Create new symlink
ln -s "$SCRIPT_DIR/dist/promptcode" "$LOCAL_BIN/promptcode"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$LOCAL_BIN:"* ]]; then
    echo ""
    echo "⚠️  Note: $LOCAL_BIN is not in your PATH"
    echo "Add this to your shell configuration file (.bashrc, .zshrc, etc.):"
    echo "export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

echo "✅ PromptCode CLI installed successfully!"
echo ""
echo "Try it out:"
echo "  promptcode --help"
echo "  promptcode preset --create my-project"
echo "  promptcode generate -p my-project"