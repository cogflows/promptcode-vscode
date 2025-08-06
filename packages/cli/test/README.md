# PromptCode CLI Test Suite

This directory contains comprehensive tests for the PromptCode CLI.

## Structure

- `test-utils.ts` - Shared utilities for tests
- `system.test.ts` - System-level tests
- `basic.test.ts` - Basic functionality tests
- `hooks/` - Hook-related tests

## Running Tests

### All Tests
```bash
npm test
# or
bun test
```

### Specific Test File
```bash
bun test test/commands/preset.test.ts
```

### Smoke Tests (Quick Manual Check)
```bash
./test/smoke-test.sh
```

### Full Test Suite with Build
```bash
./test/run-tests.sh
```

## Test Features

1. **Isolated Testing**: Each test creates its own temporary directory
2. **Automatic Cleanup**: Test fixtures are cleaned up after each test
3. **Realistic CLI Testing**: Tests spawn actual CLI process
4. **Timeout Protection**: Tests have configurable timeouts (default 30s)
5. **Output Capture**: Both stdout and stderr are captured

## Writing New Tests

Use the test utilities:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestFixture, createTestFiles, runCLI, assertFileExists } from '../test-utils';

describe('my command', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  
  beforeEach(() => {
    fixture = createTestFixture('my-test');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });
  
  it('should do something', async () => {
    // Create test files
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // Run CLI command
    const result = await runCLI(['my-command'], { cwd: fixture.dir });
    
    // Assert results
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('expected output');
  });
});
```

## CI/CD Integration

Tests work in CI environments with proper cleanup and exit codes.

## Coverage

Run tests with coverage:
```bash
bun test --coverage
```