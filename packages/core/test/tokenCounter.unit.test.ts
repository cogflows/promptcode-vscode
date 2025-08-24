/**
 * Unit tests for tokenCounter with real files in a temp dir.
 * Verifies hashing, cache hits/misses, binary detection, and invalidation.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
  initializeTokenCounter,
  clearTokenCache,
  tokenCache,
  countTokensWithCache,
  countTokensInFile
} from '../src/tokenCounter';

let tmp: string;

describe('tokenCounter', () => {
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'pc-core-token-'));
    initializeTokenCounter(tmp, 'test-1.0.0');
    clearTokenCache();
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('caches counts and validates by sha256', async () => {
    const f = path.join(tmp, 'a.txt');
    writeFileSync(f, 'hello world');

    const c1 = await countTokensWithCache(f);
    expect(c1).toBeGreaterThan(0);
    const entry1 = tokenCache.get(f)!;
    expect(entry1.sha256).toBeTruthy();

    const c2 = await countTokensWithCache(f);
    expect(c2).toBe(c1); // cache hit

    // same size, different content → should invalidate via hash
    writeFileSync(f, 'xello world'); // same length as 'hello world'
    const c3 = await countTokensWithCache(f);
    expect(c3).not.toBe(c1);
    const entry2 = tokenCache.get(f)!;
    expect(entry2.sha256).not.toBe(entry1.sha256);
  });

  test('returns 0 tokens for binary-like files', async () => {
    const f = path.join(tmp, 'bin.dat');
    // include a null byte to simulate binary
    writeFileSync(f, Buffer.from([0x00, 0x01, 0x02, 0xFF]));
    const c = await countTokensInFile(f);
    expect(c).toBe(0);
  });

  test('gracefully handles missing files', async () => {
    const missing = path.join(tmp, 'missing.txt');
    const c = await countTokensWithCache(missing);
    expect(c).toBe(0);
    expect(tokenCache.has(missing)).toBe(false);
  });
});