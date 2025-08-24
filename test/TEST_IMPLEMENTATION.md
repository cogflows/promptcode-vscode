# PromptCode Testing Implementation

## Overview
Complete testing framework implemented following GPT-5's recommendations for proper regression prevention across the VS Code extension, CLI, and core packages.

## Test Structure

### 1. Core Package Tests (60% of coverage)
**Location:** `packages/core/test/*.unit.test.ts`
- `tokenCounter.unit.test.ts` - Token counting with cache validation
- `filePattern.unit.test.ts` - Pattern parsing and matching
- `buildTreeFromSelection.unit.test.ts` - Tree structure generation
- `markdownParser.unit.test.ts` - AI response parsing

**Run:** `cd packages/core && npm test`

### 2. CLI Tests (Existing)
**Location:** `packages/cli/test/`
- Comprehensive test suite already in place
- Uses bun for fast execution
- Includes unit, integration, and command tests

**Run:** `cd packages/cli && bun test`

### 3. Extension Host Tests (20% of coverage)
**Location:** `src/test/ext/*.test.ts`
- `activation.test.ts` - Extension activation and command registration
- `promptGeneration.test.ts` - Prompt generation pipeline
- `fileSelection.test.ts` - File explorer and selection logic

**Run:** `npm run test:unit`

### 4. Webview Tests (10% of coverage)
**Location:** `test/webview/*.spec.ts`
- `generate-tab.spec.ts` - Generate prompt tab interactions
- `select-files-tab.spec.ts` - File selection UI
- `csp-basic.spec.ts` - CSP violation detection (existing)
- `csp-render.spec.ts` - CSP rendering tests (existing)

**Run:** `npm run test:webview`

### 5. Static Analysis
**Location:** `scripts/check-csp.sh`
- Grep-based CSP violation detection
- Runs in CI before other tests

**Run:** `./scripts/check-csp.sh`

## Test Pyramid

```
         /\
        /E2E\       5% - Full integration (2-3 smoke tests)
       /------\
      /Webview \    10% - UI interactions (Playwright)
     /----------\
    / Extension  \  20% - Commands & integration
   /--------------\
  /  Core & CLI    \ 65% - Unit tests (Jest/Bun)
 /------------------\
```

## CI/CD Integration

### GitHub Actions Workflow
`.github/workflows/test.yml` runs:
1. **test-core** - Core package unit tests
2. **test-extension** - Extension host tests + webview tests
3. **test-cli** - CLI tests with bun

### Local Development

```bash
# Run all tests
npm test

# Run specific layers
npm run test:unit       # Extension host tests
npm run test:webview    # Playwright webview tests
cd packages/core && npm test  # Core unit tests
cd packages/cli && bun test   # CLI tests

# Watch mode
cd packages/core && npm run test:watch
```

## Key Design Decisions

1. **Layered Testing**: Following test pyramid with most coverage in unit tests
2. **Mock VS Code API**: Webview tests use mocked `acquireVsCodeApi` for isolation
3. **Hermetic Tests**: No network calls, deterministic fixtures, temp directories
4. **Fast Feedback**: Core tests in Jest, CLI in Bun for speed
5. **CSP Focus**: Static analysis + runtime checks for CSP violations

## Test Utilities

- `packages/cli/test/test-utils.ts` - CLI test helpers
- `test/webview/test-harness.html` - Webview test harness
- Mock VS Code API for webview isolation
- Fixture generators for temp workspaces

## Coverage Goals

- Core package: 80%+ coverage
- CLI: 70%+ coverage (already achieved)
- Extension host: 60%+ coverage
- Webview: Focus on critical paths, not pixel-perfect

## Next Steps for Full Integration

1. **Add data-testid attributes** to webview HTML for more stable selectors
2. **Golden file tests** for prompt generation
3. **Performance benchmarks** for token counting
4. **Contract tests** for message passing schemas
5. **Visual regression tests** (optional, for critical UI states)

## Notes

- Tests are designed to catch real regressions like Issue #17 (CSP violations)
- Focus on behavior over implementation details
- Fast enough for PR checks (< 5 minutes total)
- Artifacts uploaded on failure for debugging