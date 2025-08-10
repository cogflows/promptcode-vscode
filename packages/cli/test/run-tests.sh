#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 PromptCode CLI Test Suite"
echo "============================"

# Ensure we're in the right directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CLI_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$CLI_DIR"

# Build the CLI first
echo -e "\n${YELLOW}Building CLI...${NC}"
if bun run build; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

# Run tests
echo -e "\n${YELLOW}Running tests...${NC}"

# Set up test environment
export NODE_ENV=test
export PROMPTCODE_TEST=1

# Run bun tests with coverage
if bun test --coverage; then
    echo -e "\n${GREEN}✓ All tests passed!${NC}"
    EXIT_CODE=0
else
    echo -e "\n${RED}✗ Some tests failed${NC}"
    EXIT_CODE=1
fi

# Clean up any test artifacts
echo -e "\n${YELLOW}Cleaning up test artifacts...${NC}"
rm -rf /tmp/promptcode-test-*
rm -rf test-results/

echo -e "${GREEN}✓ Cleanup complete${NC}"

exit $EXIT_CODE