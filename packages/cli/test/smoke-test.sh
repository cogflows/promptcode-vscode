#!/bin/bash

# Simple smoke test for PromptCode CLI
set -e

echo "🧪 PromptCode CLI Smoke Test"
echo "============================"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Get CLI path
CLI_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
CLI_PATH="$CLI_DIR/dist/promptcode"

# Create temp directory
TEST_DIR=$(mktemp -d)
cd "$TEST_DIR"

echo -e "\n1. Testing basic generate command..."
echo 'console.log("Test");' > test.js
"$CLI_PATH" generate -f "*.js" --output output.txt
if [ -f output.txt ] && grep -q "console.log" output.txt; then
    echo -e "${GREEN}✓ Generate with output works${NC}"
else
    echo -e "${RED}✗ Generate with output failed${NC}"
    exit 1
fi

echo -e "\n2. Testing preset creation..."
"$CLI_PATH" preset create test-preset
if [ -f .promptcode/presets/test-preset.patterns ]; then
    echo -e "${GREEN}✓ Preset creation works${NC}"
else
    echo -e "${RED}✗ Preset creation failed${NC}"
    exit 1
fi

echo -e "\n3. Testing preset info with usage examples..."
OUTPUT=$("$CLI_PATH" preset info test-preset)
if echo "$OUTPUT" | grep -q "Usage Examples:" && echo "$OUTPUT" | grep -q "promptcode generate --preset"; then
    echo -e "${GREEN}✓ Preset info shows usage examples${NC}"
else
    echo -e "${RED}✗ Preset info missing usage examples${NC}"
    exit 1
fi

echo -e "\n4. Testing generate with preset..."
"$CLI_PATH" generate --preset test-preset --output preset-output.txt
if [ -f preset-output.txt ]; then
    echo -e "${GREEN}✓ Generate with preset works${NC}"
else
    echo -e "${RED}✗ Generate with preset failed${NC}"
    exit 1
fi

echo -e "\n5. Testing CC integration..."
"$CLI_PATH" cc
if [ -f CLAUDE.md ] && grep -q "PROMPTCODE-CLI-START" CLAUDE.md; then
    echo -e "${GREEN}✓ CC integration works${NC}"
else
    echo -e "${RED}✗ CC integration failed${NC}"
    exit 1
fi

echo -e "\n6. Testing CC uninstall..."
"$CLI_PATH" cc --uninstall
if [ ! -f CLAUDE.md ]; then
    echo -e "${GREEN}✓ CC uninstall works${NC}"
else
    echo -e "${RED}✗ CC uninstall failed${NC}"
    exit 1
fi

# Cleanup
cd ..
rm -rf "$TEST_DIR"

echo -e "\n${GREEN}✅ All smoke tests passed!${NC}"