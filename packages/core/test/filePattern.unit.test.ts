/**
 * Unit tests for filePattern utilities.
 * Tests pattern parsing, matching, and optimization.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
  parsePatterns,
  parsePatternLines,
  getFilesMatchingPatterns,
  listFilesByPatternsFile
} from '../src/utils/filePattern';

let tmp: string;

describe('filePattern', () => {
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'pc-core-pattern-'));
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  describe('parsePatterns', () => {
    test('parses basic patterns', () => {
      const patterns = parsePatterns('src/**/*.ts\n!*.test.ts');
      expect(patterns.includePatterns).toEqual(['src/**/*.ts']);
      expect(patterns.excludePatterns).toEqual(['*.test.ts']);
    });

    test('handles empty patterns', () => {
      const patterns = parsePatterns('');
      expect(patterns.includePatterns).toHaveLength(0);
      expect(patterns.excludePatterns).toHaveLength(0);
    });

    test('filters empty lines', () => {
      const patterns = parsePatterns('src/*.ts\n\n!test.ts\n');
      expect(patterns.includePatterns).toEqual(['src/*.ts']);
      expect(patterns.excludePatterns).toEqual(['test.ts']);
    });
  });

  describe('parsePatternLines', () => {
    test('handles multiline patterns with comments', () => {
      const input = `
# Source files
src/**/*.ts
src/**/*.js

# Exclude tests
!**/*.test.ts
!**/*.spec.ts
      `.trim();
      
      const patterns = parsePatternLines(input.split('\n'));
      expect(patterns.includePatterns).toHaveLength(2);
      expect(patterns.excludePatterns).toHaveLength(2);
    });

    test('ignores comments and empty lines', () => {
      const patterns = parsePatternLines([
        '# comment',
        '',
        'src/*.ts',
        '  ',
        '!test.ts'
      ]);
      expect(patterns.includePatterns).toHaveLength(1);
      expect(patterns.excludePatterns).toHaveLength(1);
    });
  });

  describe('getFilesMatchingPatterns', () => {
    test('matches files with glob patterns', async () => {
      // Create test structure
      mkdirSync(path.join(tmp, 'src'));
      mkdirSync(path.join(tmp, 'test'));
      writeFileSync(path.join(tmp, 'src', 'index.ts'), 'export {}');
      writeFileSync(path.join(tmp, 'src', 'utils.ts'), 'export {}');
      writeFileSync(path.join(tmp, 'test', 'index.test.ts'), 'test()');

      const files = await getFilesMatchingPatterns(
        { includePatterns: ['src/**/*.ts'], excludePatterns: [] },
        tmp
      );

      expect(files).toHaveLength(2);
      expect(files.some(f => f.endsWith('index.ts'))).toBe(true);
      expect(files.some(f => f.endsWith('utils.ts'))).toBe(true);
    });

    test('excludes patterns work', async () => {
      mkdirSync(path.join(tmp, 'src'));
      writeFileSync(path.join(tmp, 'src', 'index.ts'), 'export {}');
      writeFileSync(path.join(tmp, 'src', 'index.test.ts'), 'test()');

      const files = await getFilesMatchingPatterns(
        { includePatterns: ['src/**/*.ts'], excludePatterns: ['**/*.test.ts'] },
        tmp
      );

      expect(files).toHaveLength(1);
      expect(files[0]).toContain('index.ts');
      expect(files[0]).not.toContain('test.ts');
    });

    test('returns empty for no matches', async () => {
      const files = await getFilesMatchingPatterns(
        { includePatterns: ['*.nonexistent'], excludePatterns: [] },
        tmp
      );
      expect(files).toHaveLength(0);
    });
  });

  describe('listFilesByPatternsFile', () => {
    test('reads patterns from file', async () => {
      const patternsFile = path.join(tmp, 'patterns.txt');
      writeFileSync(patternsFile, 'src/**/*.ts\n!**/*.test.ts');

      mkdirSync(path.join(tmp, 'src'));
      writeFileSync(path.join(tmp, 'src', 'index.ts'), 'export {}');
      writeFileSync(path.join(tmp, 'src', 'index.test.ts'), 'test()');

      const files = await listFilesByPatternsFile(patternsFile, tmp);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('index.ts');
      expect(files[0]).not.toContain('test.ts');
    });

    test('rejects path traversal', async () => {
      // Create a patterns file with path traversal attempt
      const patternsFile = path.join(tmp, 'traversal.patterns');
      await fs.writeFile(patternsFile, '../../../etc/passwd\n../../src/**/*.ts');
      
      // Should reject patterns with path traversal
      await expect(listFilesByPatternsFile(patternsFile, tmp)).rejects.toThrow(/Unsafe pattern/);
    });

    test('handles missing file gracefully', async () => {
      const missing = path.join(tmp, 'missing.patterns');
      await expect(listFilesByPatternsFile(missing, tmp)).rejects.toThrow();
    });
  });
});