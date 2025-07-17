# Running Unit Tests for PromptCode

This extension includes unit tests for the file pattern matching functionality.

## Test Structure

The tests are organized as follows:
- `src/test/filePattern.test.ts` - Tests for pattern parsing and file matching
- `src/test/generatePatternsFromSelection.test.ts` - Tests for pattern generation heuristics

## Running Tests

### Option 1: Direct Node Execution (Recommended for CI)
```bash
npm run compile:tests
node run-unit-tests.js
```

### Option 2: VS Code Test Runner
```bash
npm test
```

### Option 3: NPM Script
```bash
npm run test:unit
```

## What the Tests Cover

### Pattern Parsing Tests
- Simple inclusion patterns (e.g., `src/**`, `package.json`)
- Exclusion patterns (e.g., `!node_modules/**`)
- Comment and whitespace handling
- Default behavior with no patterns

### Pattern Generation Tests
- Single file selection → single pattern
- Complete directory selection → directory pattern (`dir/**`)
- Partial directory selection → individual file patterns
- Mixed selections across multiple directories

### Integration Tests
- Real file system operations
- Complex pattern combinations
- Edge cases like hidden files and empty directories

## Known Issues

Some tests are currently failing due to the pattern generation heuristic being too aggressive in creating `**` patterns. This needs refinement to better handle edge cases.

## Adding New Tests

1. Add test files in `src/test/` with `.test.ts` extension
2. Import the functions you want to test
3. Use the Mocha TDD style (`suite`, `test`, `suiteSetup`, etc.)
4. Run `npm run compile:tests` before running tests

## Example Test

```typescript
suite('My New Tests', () => {
  test('should do something', () => {
    const result = myFunction('input');
    assert.strictEqual(result, 'expected output');
  });
});
```