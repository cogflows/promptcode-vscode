#!/bin/bash
# Run tests suitable for CI environment

echo "Running CLI tests in CI mode..."

# Set dummy API keys
export OPENAI_API_KEY="sk-test-dummy"
export ANTHROPIC_API_KEY="sk-ant-test-dummy"
export GEMINI_API_KEY="test-dummy"
export GROK_API_KEY="test-dummy"
export CI="true"

# Run only fast, non-interactive tests
echo "Running hook tests..."
bun test test/hooks/approval-hook.test.ts

echo "Running CC command tests..."
bun test test/commands/cc.test.ts

# Skip these tests in CI as they spawn actual CLI processes:
# - test/cli-parsing.test.ts (spawns CLI)
# - test/commands/expert.test.ts (might wait for input)
# - test/commands/generate.test.ts (spawns CLI)
# - test/commands/preset.test.ts (spawns CLI)
# - test/integration.test.ts (spawns CLI multiple times)

echo "Skipping integration tests that spawn CLI processes in CI"
echo "These tests should be run locally before pushing"

echo "CLI CI tests completed!"