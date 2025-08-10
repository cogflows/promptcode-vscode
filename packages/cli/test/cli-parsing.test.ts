import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestFixture, createTestFiles, runCLI } from './test-utils';

describe('CLI argument parsing', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  
  beforeEach(() => {
    fixture = createTestFixture('parsing-test');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });
  
  it('should require explicit expert command', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");',
      'backend/auth.ts': 'export const auth = {};'
    });
    
    // These should now fail without explicit command
    const testCases = [
      { args: ['"Why is this slow?"', 'src/**/*.ts'] },
      { args: ['"Explain the auth flow"', 'backend/**/*.ts'] },
      { args: ["'What are the security risks?'", 'src/**/*.ts'] },
    ];
    
    for (const testCase of testCases) {
      // Should fail with invalid usage error
      const result = await runCLI(testCase.args, { 
        cwd: fixture.dir
      });
      
      // Should fail with error about invalid usage
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output.toLowerCase()).toContain('invalid usage');
    }
    
    // Test that explicit expert command works (fails with API key error)
    const result = await runCLI(['expert', '"Why is this slow?"', '-f', 'src/**/*.ts'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GOOGLE_API_KEY: '', XAI_API_KEY: '', GROK_API_KEY: '' }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('API key');
  });
  
  it('should require explicit generate command', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");',
      'src/utils.ts': 'export const util = 1;',
      'tests/test.ts': 'describe("test", () => {});',
      'main.js': 'console.log("js");'
    });
    
    // These should now fail without explicit command
    const testCases = [
      { args: ['src/**/*.ts'] },
      { args: ['src/**/*', 'tests/**/*'] },
      { args: ['*.js', 'src/**/*.ts'] },
    ];
    
    for (const testCase of testCases) {
      const result = await runCLI(testCase.args, { cwd: fixture.dir });
      
      // Should fail with invalid usage error
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output.toLowerCase()).toContain('invalid usage');
    }
    
    // Test that explicit generate command works
    const result = await runCLI(['generate', '-f', 'src/**/*.ts'], { cwd: fixture.dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('console.log("Test")');
  });
  
  it('should handle @ prefix in file patterns with explicit command', async () => {
    createTestFiles(fixture.dir, {
      'backend/server.ts': 'const server = {};',
      'frontend/app.tsx': 'const app = {};'
    });
    
    // @ prefix no longer works without explicit command
    const result1 = await runCLI(['@backend/**/*.ts'], { cwd: fixture.dir });
    expect(result1.exitCode).toBe(1);
    expect((result1.stdout + result1.stderr).toLowerCase()).toContain('invalid usage');
    
    // @ prefix should be stripped with explicit command
    const result2 = await runCLI(['generate', '-f', '@backend/*.ts'], { cwd: fixture.dir });
    expect(result2.exitCode).toBe(0);
    expect(result2.stdout).toContain('const server');
    expect(result2.stdout).not.toContain('const app');
  });
  
  it('should require explicit command even with --save-preset', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // Should fail without explicit command
    const result = await runCLI(['src/**/*.ts', '--save-preset', 'my-files'], { cwd: fixture.dir });
    expect(result.exitCode).toBe(1);
    expect((result.stdout + result.stderr).toLowerCase()).toContain('invalid usage');
    
    // Test that explicit generate command with --save-preset works
    const result2 = await runCLI(['generate', '-f', 'src/**/*.ts', '--save-preset', 'my-files'], { cwd: fixture.dir });
    expect(result2.exitCode).toBe(0);
    // Should generate the prompt output
    expect(result2.stdout).toContain('console.log("Test")');
  });
  
  it('should show help when no arguments provided', async () => {
    const result = await runCLI([], { cwd: fixture.dir });
    
    // Commander.js exits with 1 when showing help via program.help()
    // but the help text should still be shown
    const output = result.stdout + result.stderr;
    expect(output).toContain('promptcode');
    expect(output).toContain('generate');
    // Accept either exit code 0 or 1 (commander.js behavior varies)
    expect([0, 1]).toContain(result.exitCode);
  });
  
  it('should handle unknown commands with error', async () => {
    const result = await runCLI(['unknowncommand'], { cwd: fixture.dir });
    
    // Should exit with error code 1
    expect(result.exitCode).toBe(1);
    
    // Should show some error output (not checking exact text to avoid brittleness)
    const output = result.stdout + result.stderr;
    expect(output.length).toBeGreaterThan(0);
    // Just verify it mentions the unknown command somehow
    expect(output.toLowerCase()).toContain('unknowncommand');
  });
  
  it('should handle traditional command syntax', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // Traditional generate command
    let result = await runCLI(['generate', '-f', 'src/**/*.ts'], { cwd: fixture.dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('console.log("Test")');
    
    // Traditional preset command
    result = await runCLI(['preset', 'create', 'test'], { cwd: fixture.dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created preset: test');
  });
});