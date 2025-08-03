import { describe, test, expect, beforeEach } from 'bun:test';
import { AIProvider, normalizeUsage } from './ai-provider';

describe('AIProvider', () => {
  let provider: AIProvider;

  beforeEach(() => {
    // Create instance without any API keys for testing
    provider = new AIProvider();
  });

  describe('normalizeUsage', () => {

    test('should handle undefined usage', () => {
      expect(normalizeUsage(undefined)).toBeUndefined();
      expect(normalizeUsage(null)).toBeUndefined();
    });

    test('should normalize Vercel AI SDK format (inputTokens/outputTokens)', () => {
      const usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      };

      const result = normalizeUsage(usage);
      expect(result).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
      });
    });

    test('should normalize OpenAI format (promptTokens/completionTokens)', () => {
      const usage = {
        promptTokens: 200,
        completionTokens: 75,
        totalTokens: 275
      };

      const result = normalizeUsage(usage);
      expect(result).toEqual({
        promptTokens: 200,
        completionTokens: 75,
        totalTokens: 275
      });
    });

    test('should normalize Google/PaLM format (tokensProcessed/tokensGenerated)', () => {
      const usage = {
        tokensProcessed: 300,
        tokensGenerated: 100,
        totalTokens: 400
      };

      const result = normalizeUsage(usage);
      expect(result).toEqual({
        promptTokens: 300,
        completionTokens: 100,
        totalTokens: 400
      });
    });

    test('should calculate totalTokens if not provided', () => {
      const usage = {
        inputTokens: 100,
        outputTokens: 50
      };

      const result = normalizeUsage(usage);
      expect(result).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
      });
    });

    test('should handle string token values', () => {
      const usage = {
        inputTokens: '100',
        outputTokens: '50',
        totalTokens: '150'
      };

      const result = normalizeUsage(usage);
      expect(result).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
      });
    });

    test('should handle NaN values', () => {
      const usage = {
        inputTokens: 'not-a-number',
        outputTokens: undefined,
        totalTokens: null
      };

      const result = normalizeUsage(usage);
      expect(result).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      });
    });

    test('should handle mixed formats (prefer first matching field)', () => {
      const usage = {
        inputTokens: 100,
        promptTokens: 200, // Should use inputTokens (first in map)
        outputTokens: 50,
        completionTokens: 75 // Should use outputTokens (first in map)
      };

      const result = normalizeUsage(usage);
      expect(result).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
      });
    });

    test('should warn for unknown usage format', () => {
      // Temporarily restore console.warn for this test
      const warnMessages: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string, ...args: any[]) => {
        warnMessages.push(msg);
      };

      const usage = {
        unknownField1: 100,
        unknownField2: 50
      };

      normalizeUsage(usage);
      expect(warnMessages[0]).toBe('[promptcode] Unknown usage object shape:');

      // Restore original mock
      console.warn = originalWarn;
    });

    test('should not warn for empty but known format', () => {
      // Mock console.warn
      const originalWarn = console.warn;
      let warnCalled = false;
      console.warn = () => {
        warnCalled = true;
      };

      const usage = {
        inputTokens: 0,
        outputTokens: 0
      };

      normalizeUsage(usage);
      expect(warnCalled).toBe(false);

      // Restore console.warn
      console.warn = originalWarn;
    });
  });

  describe('calculateCost', () => {
    test('should calculate cost correctly for o3-mini', () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500
      };

      // o3-mini: $0.5/$2 per million
      const cost = provider.calculateCost('o3-mini', usage);
      expect(cost).toBeCloseTo(0.0015, 4); // (1000/1M * 0.5) + (500/1M * 2)
    });

    test('should calculate cost correctly for o3-pro', () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500
      };

      // o3-pro: $20/$80 per million
      const cost = provider.calculateCost('o3-pro', usage);
      expect(cost).toBeCloseTo(0.06, 4); // (1000/1M * 20) + (500/1M * 80)
    });

    test('should return 0 for unknown model', () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500
      };

      const cost = provider.calculateCost('unknown-model', usage);
      expect(cost).toBe(0);
    });

    test('should handle zero tokens', () => {
      const usage = {
        promptTokens: 0,
        completionTokens: 0
      };

      const cost = provider.calculateCost('o3', usage);
      expect(cost).toBe(0);
    });
  });
});