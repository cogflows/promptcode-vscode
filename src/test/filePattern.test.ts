import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { 
  parsePatternLines, 
  getFilesMatchingPatterns,
  listFilesByPattern,
  listFilesByPatternsFile,
  ParsedPatterns 
} from '@promptcode/core';

suite('File Pattern Tests', () => {
  suite('parsePatternLines', () => {
    test('should parse simple inclusion patterns', () => {
      const lines = ['src/**', 'package.json', 'README.md'];
      const result = parsePatternLines(lines);
      
      assert.deepStrictEqual(result.includePatterns, ['src/**', 'package.json', 'README.md']);
      assert.deepStrictEqual(result.excludePatterns, []);
    });

    test('should parse exclusion patterns', () => {
      const lines = ['src/**', '!src/test/**', '!src/**/*.test.ts'];
      const result = parsePatternLines(lines);
      
      assert.deepStrictEqual(result.includePatterns, ['src/**']);
      assert.deepStrictEqual(result.excludePatterns, ['src/test/**', 'src/**/*.test.ts']);
    });

    test('should skip empty lines and comments', () => {
      const lines = [
        'src/**',
        '',
        '  ',
        '# This is a comment',
        '!node_modules/**',
        '# Another comment'
      ];
      const result = parsePatternLines(lines);
      
      assert.deepStrictEqual(result.includePatterns, ['src/**']);
      assert.deepStrictEqual(result.excludePatterns, ['node_modules/**']);
    });

    test('should handle no inclusion patterns by defaulting to all files', () => {
      const lines = ['!node_modules/**', '!.git/**'];
      const result = parsePatternLines(lines);
      
      assert.deepStrictEqual(result.includePatterns, ['**/*']);
      assert.deepStrictEqual(result.excludePatterns, ['node_modules/**', '.git/**']);
    });

    test('should trim whitespace from patterns', () => {
      const lines = ['  src/**  ', '  !test/**  '];
      const result = parsePatternLines(lines);
      
      assert.deepStrictEqual(result.includePatterns, ['src/**']);
      assert.deepStrictEqual(result.excludePatterns, ['test/**']);
    });
  });

  suite('Integration tests with real files', () => {
    let testDir: string;

    suiteSetup(async () => {
      // Create a temporary test directory
      testDir = path.join(os.tmpdir(), `promptcode-test-${Date.now()}`);
      await fs.promises.mkdir(testDir, { recursive: true });

      // Create test file structure
      const files = [
        'src/index.ts',
        'src/utils/helper.ts',
        'src/test/index.test.ts',
        'src/test/helper.test.ts',
        'test/e2e/app.test.ts',
        'package.json',
        'README.md',
        '.gitignore',
        'node_modules/lodash/index.js'
      ];

      for (const file of files) {
        const filePath = path.join(testDir, file);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, `// ${file}`);
      }
    });

    suiteTeardown(async () => {
      // Clean up test directory
      await fs.promises.rm(testDir, { recursive: true, force: true });
    });

    test('should match single file pattern', async () => {
      const files = await listFilesByPattern('package.json', testDir);
      assert.deepStrictEqual(files, ['package.json']);
    });

    test('should match glob pattern', async () => {
      const files = await listFilesByPattern('src/**/*.ts', testDir);
      assert.deepStrictEqual(files, [
        'src/index.ts',
        'src/test/helper.test.ts',
        'src/test/index.test.ts',
        'src/utils/helper.ts'
      ]);
    });

    test('should handle patterns with exclusions', async () => {
      const patterns: ParsedPatterns = {
        includePatterns: ['src/**/*.ts'],
        excludePatterns: ['src/test/**']
      };
      
      const files = await getFilesMatchingPatterns(patterns, testDir);
      assert.deepStrictEqual(files, [
        'src/index.ts',
        'src/utils/helper.ts'
      ]);
    });

    test('should read patterns from file', async () => {
      // Create a patterns file
      const patternFile = path.join(testDir, 'test.patterns');
      const patternContent = `
# Include all TypeScript files in src
src/**/*.ts
# But exclude test files
!src/test/**
# Include package.json
package.json
`;
      await fs.promises.writeFile(patternFile, patternContent);

      const files = await listFilesByPatternsFile(patternFile, testDir);
      assert.deepStrictEqual(files, [
        'package.json',
        'src/index.ts',
        'src/utils/helper.ts'
      ]);
    });

    test('should handle single file preset correctly', async () => {
      // This tests the exact issue the user reported
      const patternFile = path.join(testDir, 'single-file.patterns');
      await fs.promises.writeFile(patternFile, 'package.json');

      const files = await listFilesByPatternsFile(patternFile, testDir);
      assert.deepStrictEqual(files, ['package.json']);
    });

    test('should match hidden files when using dot option', async () => {
      const files = await listFilesByPattern('.gitignore', testDir);
      assert.deepStrictEqual(files, ['.gitignore']);
    });

    test('should handle complex mixed patterns', async () => {
      const patternFile = path.join(testDir, 'complex.patterns');
      const patternContent = `
# All files
**/*
# Exclude node_modules
!node_modules/**
# Exclude all test files
!**/*.test.ts
# Exclude pattern files
!**/*.patterns
`;
      await fs.promises.writeFile(patternFile, patternContent);

      const files = await listFilesByPatternsFile(patternFile, testDir);
      assert.deepStrictEqual(files, [
        '.gitignore',
        'README.md',
        'package.json',
        'src/index.ts',
        'src/utils/helper.ts'
      ]);
    });
  });
});