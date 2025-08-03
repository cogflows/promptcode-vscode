# Contributing to PromptCode CLI

## Adding New AI Models

When adding support for new AI models, please follow these guidelines:

### Pricing Convention

All pricing values in `src/providers/models.ts` must be in **USD per million tokens**:

- `pricing.input`: Cost per million input tokens
- `pricing.output`: Cost per million output tokens

#### Conversion Examples:

If a provider charges:
- $0.001 per 1K tokens → Use `1.0` (multiply by 1000)
- $0.01 per 1K tokens → Use `10.0`
- $5 per million tokens → Use `5.0` (no conversion needed)

#### Example Model Configuration:

```typescript
'new-model': {
  provider: 'openai',
  modelId: 'gpt-new',
  name: 'GPT New',
  description: 'New model with advanced capabilities',
  contextWindow: 128000,
  pricing: { 
    input: 10.0,   // $10 per million input tokens
    output: 30.0   // $30 per million output tokens
  }
}
```

### Token Field Mapping

The AI provider SDKs use different field names for token counts. Our normalization supports:

- **Vercel AI SDK**: `inputTokens`, `outputTokens`
- **OpenAI SDK**: `promptTokens`, `completionTokens`
- **Google/PaLM SDK**: `tokensProcessed`, `tokensGenerated`

If you encounter a new naming convention, update the `TOKEN_FIELD_MAP` in `src/providers/ai-provider.ts`.

## Running Tests

```bash
cd packages/cli
bun test
```

Tests are required for all new features and bug fixes.