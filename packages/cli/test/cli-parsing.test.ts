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
  
  it('should parse zero-friction expert commands', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // These should be interpreted as expert commands (with question)
    const testCases = [
      { args: ['"Why is this slow?"', 'src/**/*.ts'], hasQuestion: true },
      { args: ['"Explain the auth flow"', '@backend/'], hasQuestion: true },
      { args: ["'What are the security risks?'"], hasQuestion: true },
    ];
    
    for (const testCase of testCases) {
      // We can't fully test expert without API keys, but we can verify it tries to run expert
      const result = await runCLI(testCase.args, { 
        cwd: fixture.dir,
        env: { ...process.env, OPENAI_API_KEY: '' }
      });
      
      // Should fail asking for API key (meaning it tried expert command)
      expect(result.exitCode).toBe(1);
      // Error message could be on stdout or stderr
      const output = result.stdout + result.stderr;
      expect(output).toContain('API key');
    }
  });
  
  it('should parse zero-friction generate commands', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");',
      'src/utils.ts': 'export const util = 1;'
    });
    
    // These should be interpreted as generate commands (no question)
    const testCases = [
      { args: ['src/**/*.ts'] },
      { args: ['@src/', '@tests/'] },
      { args: ['*.js', '*.ts'] },
    ];
    
    for (const testCase of testCases) {
      const result = await runCLI(testCase.args, { cwd: fixture.dir });
      
      // Should succeed and output prompt
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('console.log("Test")');
    }
  });
  
  it('should handle @ prefix in file patterns', async () => {
    createTestFiles(fixture.dir, {
      'backend/server.ts': 'const server = {};',
      'frontend/app.tsx': 'const app = {};'
    });
    
    // @ prefix should be stripped
    const result = await runCLI(['@backend/**/*.ts'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('const server');
    expect(result.stdout).not.toContain('const app');
  });
  
  it('should save preset with zero-friction syntax', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    const result = await runCLI(['src/**/*.ts', '--save-preset', 'my-files'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Saved file patterns to preset: my-files');
  });
  
  it('should show help when no arguments provided', async () => {
    const result = await runCLI([], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('promptcode');
    expect(result.stdout).toContain('generate');
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