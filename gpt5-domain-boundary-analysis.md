# GPT-5 Domain Boundary Analysis

**Generated:** 2025-08-13  
**Model:** GPT-5  
**Cost:** $0.0886 (30,943 tokens in, 4,996 tokens out)

## Executive Summary

GPT-5 recommends making the CLI the single source of truth for models, pricing, capabilities, cost estimation, approval thresholds, and token limits. Agent layers (Claude/Cursor) should be thin orchestrators that collect context, call the CLI in dry-run mode to fetch structured cost/model info, ask users for approval, then execute.

## Key Recommendations

### 1. Ideal Separation of Concerns

**CLI (source of truth)**
- Model registry, pricing, context windows, supportsWebSearch (`packages/cli/src/providers/models.ts`)
- Cost math and thresholds, approval policy, token-limit checks
- File scanning, prompt build, web-search capability selection
- Stable JSON output for programmatic consumption and stable exit codes

**Agent layers (.claude/commands and .cursor/rules)**
- Workflow UX only: assembling consultation files, choosing presets/files, ensemble orchestration
- Never encode pricing, model lists, or approval rules
- Use the CLI's JSON/dry-run for costs and capabilities
- Respect "never add --yes without approval"

**Shared utilities**
- Keep cost math in `utils/cost.ts` (used by CLI)
- Keep environment/CI detection in `utils/environment.ts`
- Expose an `isAgentEnvironment()` helper

### 2. Cost Management

Move all cost/threshold/approval logic into the CLI and expose it to agents:

**Add `expert --dry-run`** to perform everything up to model invocation, returning JSON with:
- `requiresApproval` (boolean), `approvalReason`
- Estimated costs, context token count, `modelInfo`
- `webSearchEnabled`, suggested output tokens
- Exit code 0 when safe, 2 when approval required

**Agent workflow:**
1. Run dry-run with `--json`
2. If `requiresApproval=true` (or exit code 2), present costs to user
3. On approval, re-run expert with `--yes` and same args

### 3. Configuration Management

- Single-source models and pricing in `providers/models.ts` only
- Add machine-readable model listing: `expert --models --json` 
- Include pricing, contextWindow, supportsWebSearch, availability
- Keep `PROMPTCODE_COST_THRESHOLD` in CLI, include in JSON responses

### 4. API Design to Support Agents

**Add `expert --dry-run`** with JSON fields:
- `schemaVersion`, `model`, `availableModels`
- `supportsWebSearch`, `requiresApproval`, `approvalReason`
- `estimatedCosts` {input, output, total}
- `context` {fileCount, contextTokens}
- `expectedOutputTokens`, `tokenWindow`, `safetyMargin`
- `warnings[]`, `webSearchEnabled`

**Stable exit codes:**
- 0 = success
- 1 = generic error  
- 2 = approval required
- 3 = missing API key
- 4 = no files matched
- 5 = context too large

**Additional features:**
- `--output-dir` and `--output-prefix` for organized artifacts
- Always return `schemaVersion` and complete usage/cost info in JSON

## Concrete Code Changes

### Must-Do Changes

#### `packages/cli/src/commands/expert.ts`
- Add `--dry-run` flag for preflight without LLM call
- Make non-interactive behavior predictable with exit code 2
- Add `expert --models --json` support
- Include comprehensive JSON schema with approval info
- Fix preset creation hint: "promptcode preset create" (not "--create")
- Use dynamic safety margin: `max(1024, contextWindow * 0.01)`

#### `packages/cli/src/providers/models.ts`
- Export `getPublicModelInfo()` helper for JSON serialization

#### `packages/cli/src/utils/cost.ts`
- Remove unused `DEFAULT_SAFETY_MARGIN` import

#### Security Hardening
- Validate preset names: `/^[a-z0-9._-]+$/i`
- Prevent path traversal in preset paths
- Consider allowlist for file globs in agent contexts

### Nice-to-Have Changes

#### `packages/cli/src/utils/environment.ts`
- Add `isAgentEnvironment()` to detect Claude/Cursor contexts

#### Performance Improvements
- Add fast preflight size-based token estimate
- Consider `--max-files` or `--max-bytes` caps for agent runs
- Reuse token counter cache with content hashing

### Template Clean-up

Remove hardcoded pricing/model lists from:
- `.claude/commands/promptcode-ask-expert.md`
- `packages/cli/src/claude-templates/promptcode-ask-expert.md`
- `packages/cli/src/cursor-templates/promptcode-ask-expert.mdc`

Replace with CLI calls: `promptcode expert --models --json` and `--dry-run --json`

## Agent-Side Ensemble Flow (After Changes)

For N models:
1. Run once: `promptcode expert --dry-run --model <m> --preset <p> --json`
2. Present consolidated cost summary to user
3. On approval, spawn parallel tasks with organized outputs:
   ```bash
   promptcode expert --model <m> --preset <p> --yes --json \
     --output-dir /tmp/expert-<timestamp> --output-prefix <model-key>
   ```
4. Read JSON outputs, extract usage/cost, synthesize results

## Migration Checklist

- [ ] Implement `expert --dry-run`, exit codes, and `--models --json`
- [ ] Remove pricing/model lists from templates; replace with CLI calls
- [ ] Add preset name validation everywhere
- [ ] Fix "preset --create" message to "preset create"
- [ ] Adopt dynamic safety margin and expose in JSON
- [ ] Update agent flows to use dry-run → approval → execute pattern
- [ ] Add CI to ensure template consistency between .claude/.cursor and packages/cli/src/*-templates

## Security & Performance Considerations

**Security:**
- Validate preset names and file globs
- Respect .gitignore (already implemented)
- Consider explicit denylist (secrets.*, .env, id_rsa)

**Performance:**
- Early file-size estimate before buildPrompt
- Optional cap flags for agent-triggered runs
- Content-based token cache reuse

This analysis provides a clear, incremental path to eliminate duplication while maintaining powerful agent workflows and ensuring cost safety.