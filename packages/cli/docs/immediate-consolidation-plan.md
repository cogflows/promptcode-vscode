# Immediate Flag Consolidation Plan (Non-Breaking)

## Quick Wins for v0.3.3

### 1. Standardize Confirmation Flags
Current: `--yes`, `--force`, `--no-confirm` all do the same thing
Action: Make them all aliases that set the same internal flag

```typescript
// In each command
const skipConfirmation = options.yes || options.force || options.noConfirm;
```

### 2. Fix `-p` Confusion
Current: `-p` means both `--path` and `--preset`
Action: Remove `-p` as alias for `--preset`, keep only for `--path`

### 3. Consolidate Test Detection
Current: Multiple checks for `PROMPTCODE_TEST`
Action: Create single utility function

```typescript
// utils/environment.ts
export function isTestEnvironment(): boolean {
  return process.env.PROMPTCODE_TEST === '1' || 
         process.env.NODE_ENV === 'test';
}

export function isInteractive(): boolean {
  return process.stdout.isTTY && 
         process.stdin.isTTY && 
         !isTestEnvironment();
}
```

### 4. Simplify Token Warning
Current: Check multiple places for threshold
Action: Single function to get threshold

```typescript
export function getTokenThreshold(options?: { tokenWarning?: number }): number {
  return options?.tokenWarning || 
         parseInt(process.env.PROMPTCODE_TOKEN_WARNING || '50000');
}
```

## Implementation Checklist

- [ ] Create `utils/environment.ts` with helper functions
- [ ] Update all commands to use helper functions
- [ ] Remove `-p` alias from preset command
- [ ] Standardize `--yes` across all commands
- [ ] Update documentation

## What NOT to Change (Yet)

1. **Don't remove old env vars** - Keep OPENAI_KEY, CLAUDE_API_KEY etc for compatibility
2. **Don't change PROMPTCODE_TEST** - Tests depend on it
3. **Don't remove --out** - Keep as alias for --output
4. **Don't change API key lookups** - Multiple aliases help users

## Testing Impact

The only breaking change is removing `-p` for preset, which is rarely used since `--preset` is clearer.

All tests should continue to pass with these changes.