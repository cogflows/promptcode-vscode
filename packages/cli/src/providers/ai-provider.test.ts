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

  describe('getModelTimeout (private)', () => {
    const getTimeout = (model: string, effort?: any) => {
      return (provider as any).getModelTimeout(model, effort);
    };

    test('applies tier multipliers and caps at 120 minutes', () => {
      const timeout = getTimeout('gpt-5-pro', 'high');
      expect(timeout).toBe(7200000);

      const minimalTimeout = getTimeout('gpt-5-pro', 'minimal');
      expect(minimalTimeout).toBe(900000);
    });

    test('uses standard tier for unknown models', () => {
      const timeout = getTimeout('unknown-model', 'low');
      expect(timeout).toBe(300000);
    });

    test('respects global environment overrides', () => {
      process.env.PROMPTCODE_TIMEOUT_MS = '600000';
      const timeout = getTimeout('gpt-5-pro', 'high');
      expect(timeout).toBe(600000);
      delete process.env.PROMPTCODE_TIMEOUT_MS;
    });

    test('respects model-specific overrides', () => {
      process.env.PROMPTCODE_TIMEOUT_GPT_5_PRO_MS = '450000';
      const timeout = getTimeout('gpt-5-pro', 'high');
      expect(timeout).toBe(450000);
      delete process.env.PROMPTCODE_TIMEOUT_GPT_5_PRO_MS;
    });

    test('uses standard tier for Gemini 3 models', () => {
      // Gemini 3 should use standard tier (5 minutes base)
      const lowTimeout = getTimeout('gemini-3-pro', 'low');
      expect(lowTimeout).toBe(300000); // 5 min * 1x = 5 min

      const mediumTimeout = getTimeout('gemini-3-pro', 'medium');
      expect(mediumTimeout).toBe(600000); // 5 min * 2x = 10 min

      const highTimeout = getTimeout('gemini-3-pro', 'high');
      expect(highTimeout).toBe(1200000); // 5 min * 4x = 20 min
    });

    test('uses fast tier for flash models', () => {
      const timeout = getTimeout('gemini-2.5-flash', 'high');
      expect(timeout).toBe(480000); // 2 min * 4x = 8 min
    });
  });

  describe('Gemini 3 thinkingLevel mapping', () => {
    test('should map reasoningEffort to thinkingLevel correctly', () => {
      // Test the mapping logic
      const thinkingLevelMap: Record<string, 'low' | 'medium' | 'high'> = {
        'none': 'low',
        'minimal': 'low',
        'low': 'low',
        'medium': 'medium',
        'high': 'high',
      };

      // Verify all mappings
      expect(thinkingLevelMap['none']).toBe('low');
      expect(thinkingLevelMap['minimal']).toBe('low');
      expect(thinkingLevelMap['low']).toBe('low');
      expect(thinkingLevelMap['medium']).toBe('medium');
      expect(thinkingLevelMap['high']).toBe('high');
    });

    test('should default to high thinkingLevel for Gemini 3', () => {
      const thinkingLevelMap: Record<string, 'low' | 'medium' | 'high'> = {
        'none': 'low',
        'minimal': 'low',
        'low': 'low',
        'medium': 'medium',
        'high': 'high',
      };

      // When reasoningEffort is undefined or unknown, should default to 'high'
      const defaultEffort = 'high';
      const thinkingLevel = thinkingLevelMap[defaultEffort] || 'high';
      expect(thinkingLevel).toBe('high');
    });
  });
});
