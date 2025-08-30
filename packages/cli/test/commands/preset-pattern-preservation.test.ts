import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { presetCommand } from '../../src/commands/preset';

describe('Preset Pattern Preservation', () => {
  let testDir: string;
  let presetsDir: string;

  beforeEach(async () => {
    // Create a temp directory for testing
    testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'promptcode-test-'));
    presetsDir = path.join(testDir, '.promptcode', 'presets');
    await fs.promises.mkdir(presetsDir, { recursive: true });
    
    // Create some test files
    await fs.promises.mkdir(path.join(testDir, 'src', 'utils'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'test'), { recursive: true });
    await fs.promises.writeFile(path.join(testDir, 'src', 'index.ts'), 'export {}');
    await fs.promises.writeFile(path.join(testDir, 'src', 'utils', 'helper.ts'), 'export {}');
    await fs.promises.writeFile(path.join(testDir, 'test', 'index.test.ts'), 'test()');
    await fs.promises.writeFile(path.join(testDir, 'package.json'), '{}');
  });

  afterEach(async () => {
    // Clean up
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  describe('Pattern Preservation', () => {
    it('should preserve glob patterns without expansion', async () => {
      await presetCommand({
        create: 'test-patterns',
        fromFiles: ['src/**/*.ts', 'test/**/*.test.ts'],
        path: testDir
      });

      const presetPath = path.join(presetsDir, 'test-patterns.patterns');
      const content = await fs.promises.readFile(presetPath, 'utf8');
      
      expect(content).toContain('src/**/*.ts');
      expect(content).toContain('test/**/*.test.ts');
      expect(content).toContain('Patterns preserved as provided: 2');
      
      // Should NOT contain individual file paths
      expect(content).not.toContain('src/index.ts');
      expect(content).not.toContain('src/utils/helper.ts');
    });

    it('should handle deep nested patterns correctly', async () => {
      await presetCommand({
        create: 'deep-patterns',
        fromFiles: ['python/cogflows-py/packages/cogflows-flows/src/**/*.py'],
        path: testDir
      });

      const presetPath = path.join(presetsDir, 'deep-patterns.patterns');
      const content = await fs.promises.readFile(presetPath, 'utf8');
      
      expect(content).toContain('python/cogflows-py/packages/cogflows-flows/src/**/*.py');
      expect(content).toContain('Patterns preserved');
    });
  });

  describe('Directory Handling', () => {
    it('should convert directories to patterns', async () => {
      await presetCommand({
        create: 'test-dirs',
        fromFiles: ['src/utils', 'test'],
        path: testDir
      });

      const presetPath = path.join(presetsDir, 'test-dirs.patterns');
      const content = await fs.promises.readFile(presetPath, 'utf8');
      
      expect(content).toContain('src/utils/**');
      expect(content).toContain('test/**');
      expect(content).toContain('Directories converted to patterns: 2');
    });
  });

  describe('File Path Optimization', () => {
    it('should optimize concrete file paths', async () => {
      // Create more files for optimization testing
      await fs.promises.writeFile(path.join(testDir, 'src', 'utils', 'logger.ts'), 'export {}');
      await fs.promises.writeFile(path.join(testDir, 'src', 'utils', 'parser.ts'), 'export {}');
      
      // Change working directory to test directory for relative paths
      const originalCwd = process.cwd();
      process.chdir(testDir);
      
      try {
        await presetCommand({
          create: 'test-files',
          fromFiles: [
            'src/utils/helper.ts',
            'src/utils/logger.ts',
            'src/utils/parser.ts'
          ],
          path: testDir
        });

        const presetPath = path.join(presetsDir, 'test-files.patterns');
        const content = await fs.promises.readFile(presetPath, 'utf8');
        
        // Should be optimized to a pattern
        expect(content).toMatch(/src\/utils\/\*\*|src\/utils\/\*\.ts/);
        expect(content).toContain('Optimized:');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Mixed Input', () => {
    it('should handle mixed patterns, directories, and files correctly', async () => {
      await presetCommand({
        create: 'test-mixed',
        fromFiles: [
          'src/**/*.ts',     // Pattern
          'test',            // Directory
          'package.json'     // File
        ],
        path: testDir
      });

      const presetPath = path.join(presetsDir, 'test-mixed.patterns');
      const content = await fs.promises.readFile(presetPath, 'utf8');
      
      expect(content).toContain('src/**/*.ts');  // Pattern preserved
      expect(content).toContain('test/**');       // Directory converted
      expect(content).toMatch(/package\.json|\*\.json/);  // File included (might be optimized)
      expect(content).toContain('mixed');
    });
  });

  describe('Windows Path Normalization', () => {
    it('should normalize Windows paths to POSIX format', async () => {
      await presetCommand({
        create: 'test-windows',
        fromFiles: ['src\\**\\*.ts', 'test\\utils'],
        path: testDir
      });

      const presetPath = path.join(presetsDir, 'test-windows.patterns');
      const content = await fs.promises.readFile(presetPath, 'utf8');
      
      expect(content).toContain('src/**/*.ts');
      expect(content).not.toContain('\\');
    });
  });

  describe('Edge Cases', () => {
    it('should handle patterns with no matches gracefully', async () => {
      await presetCommand({
        create: 'test-no-matches',
        fromFiles: ['nonexistent/**/*.xyz'],
        path: testDir
      });

      const presetPath = path.join(presetsDir, 'test-no-matches.patterns');
      const content = await fs.promises.readFile(presetPath, 'utf8');
      
      expect(content).toContain('nonexistent/**/*.xyz');
      expect(content).toContain('Patterns preserved');
    });

    it('should reject unsafe patterns with directory traversal', async () => {
      await expect(presetCommand({
        create: 'test-unsafe',
        fromFiles: ['../outside/**/*.ts'],
        path: testDir
      })).rejects.toThrow('directory traversal');
    });

    it('should handle empty input gracefully', async () => {
      await presetCommand({
        create: 'test-empty',
        fromFiles: [],
        path: testDir
      });

      const presetPath = path.join(presetsDir, 'test-empty.patterns');
      const content = await fs.promises.readFile(presetPath, 'utf8');
      
      // Should create default preset
      expect(content).toContain('**/*.ts');
      expect(content).toContain('**/*.tsx');
    });

    it('should handle filenames with bracket characters as files not patterns', async () => {
      // Create a file with brackets in the name
      await fs.promises.writeFile(path.join(testDir, 'src', 'file[1].ts'), 'export {}');
      
      const originalCwd = process.cwd();
      process.chdir(testDir);
      
      try {
        await presetCommand({
          create: 'test-brackets',
          fromFiles: ['src/file[1].ts'],
          path: testDir
        });

        const presetPath = path.join(presetsDir, 'test-brackets.patterns');
        const content = await fs.promises.readFile(presetPath, 'utf8');
        
        // Should treat it as a file, not a pattern
        expect(content).toMatch(/src\/file\[1\]\.ts|src\/\*\.ts/);
        expect(content).toContain('Optimized:');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should handle directories with trailing slashes correctly', async () => {
      await presetCommand({
        create: 'test-trailing-slash',
        fromFiles: ['src/utils/', 'test/'],
        path: testDir
      });

      const presetPath = path.join(presetsDir, 'test-trailing-slash.patterns');
      const content = await fs.promises.readFile(presetPath, 'utf8');
      
      // Should convert to patterns without double slashes
      expect(content).toContain('src/utils/**');
      expect(content).toContain('test/**');
      expect(content).not.toContain('src/utils//**');
      expect(content).not.toContain('test//**');
    });

    it('should handle truly mixed input correctly', async () => {
      await presetCommand({
        create: 'test-mixed-complex',
        fromFiles: [
          'src/**/*.ts',      // Pattern
          'test/',            // Directory with trailing slash
          'package.json',     // File
          '!**/*.spec.ts'     // Negation pattern
        ],
        path: testDir
      });

      const presetPath = path.join(presetsDir, 'test-mixed-complex.patterns');
      const content = await fs.promises.readFile(presetPath, 'utf8');
      
      expect(content).toContain('src/**/*.ts');     // Pattern preserved
      expect(content).toContain('test/**');         // Directory converted
      expect(content).toContain('!**/*.spec.ts');   // Negation preserved
      expect(content).toMatch(/package\.json|\*\.json/);  // File included
      expect(content).toContain('mixed');
    });
  });

  describe('Backward Compatibility', () => {
    it('should still work with legacy file lists', async () => {
      // Change working directory to test directory for relative paths
      const originalCwd = process.cwd();
      process.chdir(testDir);
      
      try {
        // Test that providing actual files still works
        await presetCommand({
          create: 'test-legacy',
          fromFiles: ['src/index.ts', 'src/utils/helper.ts'],
          path: testDir
        });

        const presetPath = path.join(presetsDir, 'test-legacy.patterns');
        const content = await fs.promises.readFile(presetPath, 'utf8');
        
        // Should optimize to patterns
        expect(content).toMatch(/src\/\*\*|src\/.*\.ts/);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});