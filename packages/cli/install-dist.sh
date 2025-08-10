#!/bin/bash

# PromptCode CLI Installation Script
# Supports multiple platforms and architectures

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# GitHub release URL (update this with your actual URL)
GITHUB_RELEASE_URL="https://github.com/promptcode/cli/releases/latest/download"

echo -e "${BLUE}Installing PromptCode CLI...${NC}"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Map architecture names
case $ARCH in
    x86_64)
        ARCH="x64"
        ;;
    aarch64|arm64)
        ARCH="arm64"
        ;;
    *)
        echo -e "${RED}Unsupported architecture: $ARCH${NC}"
        exit 1
        ;;
esac

# Determine download file
case $OS in
    darwin)
        # Use universal binary for macOS
        DOWNLOAD_FILE="promptcode-darwin-universal.tar.gz"
        BINARY_NAME="promptcode-darwin-universal"
        ;;
    linux)
        DOWNLOAD_FILE="promptcode-linux-${ARCH}.tar.gz"
        BINARY_NAME="promptcode-linux-${ARCH}"
        ;;
    mingw*|msys*|cygwin*)
        DOWNLOAD_FILE="promptcode-windows-x64.zip"
        BINARY_NAME="promptcode-windows-x64.exe"
        echo -e "${YELLOW}Windows detected. Manual installation required.${NC}"
        echo "Download from: ${GITHUB_RELEASE_URL}/${DOWNLOAD_FILE}"
        exit 0
        ;;
    *)
        echo -e "${RED}Unsupported operating system: $OS${NC}"
        exit 1
        ;;
esac

# Create installation directory
INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"

# Download binary
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

echo -e "${BLUE}Downloading PromptCode CLI...${NC}"
if command -v curl &> /dev/null; then
    curl -fsSL "${GITHUB_RELEASE_URL}/${DOWNLOAD_FILE}" -o "$DOWNLOAD_FILE"
elif command -v wget &> /dev/null; then
    wget -q "${GITHUB_RELEASE_URL}/${DOWNLOAD_FILE}"
else
    echo -e "${RED}Error: Neither curl nor wget found. Please install one of them.${NC}"
    exit 1
fi

# Extract binary
echo -e "${BLUE}Extracting...${NC}"
tar -xzf "$DOWNLOAD_FILE"

# Install binary
echo -e "${BLUE}Installing to $INSTALL_DIR...${NC}"
chmod +x "$BINARY_NAME"
mv "$BINARY_NAME" "$INSTALL_DIR/promptcode"

# Clean up
cd - > /dev/null
rm -rf "$TEMP_DIR"

# Check if install directory is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo -e "${YELLOW}⚠️  Note: $INSTALL_DIR is not in your PATH${NC}"
    echo -e "${YELLOW}Add this to your shell configuration file (.bashrc, .zshrc, etc.):${NC}"
    echo -e "${GREEN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    echo ""
fi

echo -e "${GREEN}✅ PromptCode CLI installed successfully!${NC}"
echo ""
echo "Get started:"
echo "  promptcode --help"
echo "  promptcode expert --list-models"
echo ""
echo "Configure API keys:"
echo "  export OPENAI_API_KEY=YOUR_KEY"
echo "  export ANTHROPIC_API_KEY=YOUR_KEY"
echo "  export GOOGLE_API_KEY=YOUR_KEY"
echo "  export XAI_API_KEY=YOUR_KEY"