import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'path';
import { createTestFixture, createTestFiles, runCLI } from '../test-utils';

describe('expert command', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  
  beforeEach(() => {
    fixture = createTestFixture('expert-test');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });
  
  it('should list available models', async () => {
    const result = await runCLI(['expert', '--list-models'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Available Models');
    expect(result.stdout).toContain('OpenAI:');
    expect(result.stdout).toContain('Anthropic:');
    expect(result.stdout).toContain('Google:');
  });
  
  it('should require a question', async () => {
    const result = await runCLI(['expert'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('I need a question to ask the AI expert');
  });
  
  it('should handle missing API key gracefully', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // Run without API keys set
    const result = await runCLI(['expert', 'What does this code do?'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        GOOGLE_API_KEY: '',
        XAI_API_KEY: ''
      }
    });
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('API key');
  });
  
  it('should load preset for context', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/test.patterns': '**/*.ts',
      'src/index.ts': 'console.log("Test");'
    });
    
    // This will fail without API key, but we can check it processes the preset
    const result = await runCLI(['expert', 'Explain this', '--preset', 'test', '--dry-run'], { 
      cwd: fixture.dir 
    });
    
    // Even with dry-run, expert command doesn't support it, but we can check the error
    expect(result.stderr).toContain('API key');
  });
  
  it('should save preset from file patterns', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // This will fail without API key, but should save the preset first
    const result = await runCLI(['expert', 'What is this?', 'src/**/*.ts', '--save-preset', 'my-expert'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: ''
      }
    });
    
    expect(result.stdout).toContain('Saved file patterns to preset: my-expert');
  });
  
  it('should require confirmation for expensive models', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // In non-interactive mode, should fail without --yes or --no-confirm
    const result = await runCLI(['expert', 'Analyze this', '--model', 'o3-pro'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        CI: 'true' // Force non-interactive
      }
    });
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Non-interactive environment detected');
    expect(result.stderr).toContain('--no-confirm');
  });
  
  it('should skip confirmation with --no-confirm', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // This will still fail without API key, but won't ask for confirmation
    const result = await runCLI(['expert', 'Analyze this', '--model', 'o3-pro', '--no-confirm'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: ''
      }
    });
    
    // Should fail for API key, not confirmation
    expect(result.stderr).toContain('API key');
    expect(result.stderr).not.toContain('Non-interactive environment');
  });
  
  it('should support --yes flag', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // Should accept --yes as alias for --no-confirm
    const result = await runCLI(['expert', 'Analyze this', '--yes'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: ''
      }
    });
    
    // Should fail for API key, not confirmation
    expect(result.stderr).toContain('API key');
    expect(result.stderr).not.toContain('Non-interactive environment');
  });
});