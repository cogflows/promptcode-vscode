import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { generatePatternsFromSelection } from '@promptcode/core';

suite('Generate Patterns From Selection Tests', () => {
  let testDir: string;

  suiteSetup(async () => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), `promptcode-pattern-gen-test-${Date.now()}`);
    await fs.promises.mkdir(testDir, { recursive: true });

    // Create test file structure
    const files = [
      'src/index.ts',
      'src/utils/helper.ts',
      'src/utils/parser.ts',
      'src/test/index.test.ts',
      'src/test/helper.test.ts',
      'lib/core.js',
      'lib/utils.js',
      'package.json',
      'README.md'
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

  test('should generate pattern for single file', () => {
    const selected = ['package.json'];
    const patterns = generatePatternsFromSelection(selected, testDir);
    
    assert.deepStrictEqual(patterns, ['package.json']);
  });

  test('should generate pattern for complete directory', () => {
    const selected = [
      'src/utils/helper.ts',
      'src/utils/parser.ts'
    ];
    const patterns = generatePatternsFromSelection(selected, testDir);
    
    // Should recognize that all files in src/utils are selected
    assert.ok(patterns.includes('src/utils/**'));
  });

  test('should handle partial directory selection', () => {
    const selected = [
      'src/index.ts',
      'src/utils/helper.ts'
      // Not selecting parser.ts
    ];
    const patterns = generatePatternsFromSelection(selected, testDir);
    
    // Should list files individually when not all files in a directory are selected
    assert.ok(patterns.includes('src/index.ts'));
    assert.ok(patterns.includes('src/utils/helper.ts'));
    assert.ok(!patterns.includes('src/utils/**'));
  });

  test('should handle empty selection', () => {
    const patterns = generatePatternsFromSelection([], testDir);
    assert.deepStrictEqual(patterns, []);
  });

  test('should generate patterns for multiple directories', () => {
    const selected = [
      'lib/core.js',
      'lib/utils.js',
      'src/test/index.test.ts',
      'src/test/helper.test.ts'
    ];
    const patterns = generatePatternsFromSelection(selected, testDir);
    
    // Should recognize complete directories
    assert.ok(patterns.includes('lib/**'));
    assert.ok(patterns.includes('src/test/**'));
  });

  test('should handle files in root directory', () => {
    const selected = [
      'package.json',
      'README.md',
      'src/index.ts'
    ];
    const patterns = generatePatternsFromSelection(selected, testDir);
    
    // Root files should be listed individually
    assert.ok(patterns.includes('package.json'));
    assert.ok(patterns.includes('README.md'));
    assert.ok(patterns.includes('src/index.ts'));
  });
});