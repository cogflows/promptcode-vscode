import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { createTestFixture, createTestFiles, runCLI } from './test-utils';

describe('system tests - core CLI functionality', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  
  beforeEach(() => {
    fixture = createTestFixture('system-test');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });

  describe('generate command', () => {
    it('should generate prompt from actual files', async () => {
      // Create a minimal test project
      createTestFiles(fixture.dir, {
        'test.js': 'console.log("hello");'
      });
      
      // Run with short timeout to prevent hanging
      const result = await runCLI(['generate', '-f', 'test.js'], { 
        cwd: fixture.dir,
        timeout: 5000,
        env: {
          ...process.env,
          PROMPTCODE_TEST: '1',  // Skip all prompts
          PROMPTCODE_TOKEN_WARNING: '999999' // Disable token warnings
        }
      });
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('console.log("hello")');
      expect(result.stdout).toContain('<file_contents>');
    });

    it('should output JSON format', async () => {
      createTestFiles(fixture.dir, {
        'test.js': 'const x = 1;'
      });
      
      const result = await runCLI(['generate', '-f', 'test.js', '--json'], { 
        cwd: fixture.dir,
        timeout: 5000 
      });
      
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json).toHaveProperty('tokenCount');
      expect(json.files).toBeArray();
    });

    it('should fail with non-existent files', async () => {
      const result = await runCLI(['generate', '-f', 'does-not-exist.ts'], { 
        cwd: fixture.dir,
        timeout: 5000 
      });
      
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No files found');
    });
  });

  describe('preset command', () => {
    it('should create preset', async () => {
      // Pre-create the .promptcode/presets directory to avoid approval prompt
      const presetsDir = path.join(fixture.dir, '.promptcode/presets');
      fs.mkdirSync(presetsDir, { recursive: true });
      
      const result = await runCLI(['preset', 'create', 'test'], { 
        cwd: fixture.dir,
        timeout: 5000 
      });
      
      expect(result.exitCode).toBe(0);
      const presetPath = path.join(fixture.dir, '.promptcode/presets/test.patterns');
      expect(fs.existsSync(presetPath)).toBe(true);
    });

    it('should list presets', async () => {
      // Create preset directory with a test preset
      const presetsDir = path.join(fixture.dir, '.promptcode/presets');
      fs.mkdirSync(presetsDir, { recursive: true });
      fs.writeFileSync(path.join(presetsDir, 'test.patterns'), '**/*.js');
      
      const result = await runCLI(['preset', 'list'], { 
        cwd: fixture.dir,
        timeout: 5000 
      });
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test');
    });
  });

  describe('stats command', () => {
    it('should show basic statistics', async () => {
      createTestFiles(fixture.dir, {
        'file1.js': 'const a = 1;',
        'file2.ts': 'const b: number = 2;'
      });
      
      const result = await runCLI(['stats'], { 
        cwd: fixture.dir,
        timeout: 5000 
      });
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Total files: 2');
      expect(result.stdout).toContain('tokens');
    });
  });

  describe('cc command', () => {
    it('should install with --yes flag', async () => {
      createTestFiles(fixture.dir, {
        'package.json': '{"name": "test"}'
      });
      
      const result = await runCLI(['cc', '--yes'], { 
        cwd: fixture.dir,
        timeout: 5000,
        env: {
          ...process.env,
          PROMPTCODE_TEST: '1'  // Ensure non-interactive
        }
      });
      
      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(path.join(fixture.dir, 'CLAUDE.md'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle invalid command', async () => {
      const result = await runCLI(['invalidcommand123'], { 
        cwd: fixture.dir,
        timeout: 5000 
      });
      
      // The CLI now properly detects unknown commands and exits with error
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output.toLowerCase()).toContain('invalidcommand123');
    });

    it('should handle missing arguments', async () => {
      const result = await runCLI(['preset', 'create'], { 
        cwd: fixture.dir,
        timeout: 5000 
      });
      
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output.toLowerCase()).toContain('requires');
    });
  });
});