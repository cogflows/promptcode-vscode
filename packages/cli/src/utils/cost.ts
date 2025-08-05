import { MODELS } from '../providers/models';

// Constants for cost estimation
export const DEFAULT_EXPECTED_COMPLETION = 4000;  // Assume ~4K output tokens
export const DEFAULT_SAFETY_MARGIN = 256;         // Leave room for stop tokens

/**
 * Estimate the cost for a model based on token counts
 * @param modelKey The model identifier
 * @param promptTokens Number of input tokens
 * @param expectedCompletion Expected output tokens (default: 4000)
 * @returns Estimated cost in USD
 */
export function estimateCost(
  modelKey: string,
  promptTokens: number,
  expectedCompletion: number = DEFAULT_EXPECTED_COMPLETION
): number {
  const modelConfig = MODELS[modelKey];
  if (!modelConfig) {
    throw new Error(`Unknown model: ${modelKey}`);
  }
  
  const inputCost = (promptTokens / 1_000_000) * modelConfig.pricing.input;
  const outputCost = (expectedCompletion / 1_000_000) * modelConfig.pricing.output;
  
  return inputCost + outputCost;
}

/**
 * Format cost as a USD string
 * @param cost The cost in USD
 * @returns Formatted string like "$0.1234"
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

/**
 * Calculate estimated costs for all models
 * @param promptTokens Number of input tokens
 * @param expectedCompletion Expected output tokens
 * @returns Object with model names as keys and formatted costs as values
 */
export function estimateCostsForAllModels(
  promptTokens: number,
  expectedCompletion: number = DEFAULT_EXPECTED_COMPLETION
): Record<string, string> {
  const costs: Record<string, string> = {};
  
  for (const [modelKey, config] of Object.entries(MODELS)) {
    const cost = estimateCost(modelKey, promptTokens, expectedCompletion);
    costs[modelKey] = formatCost(cost);
  }
  
  return costs;
}