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
    const result = await runCLI(['expert', '--models'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Available Models');
    expect(result.stdout).toContain('Openai:');
    expect(result.stdout).toContain('Anthropic:');
    expect(result.stdout).toContain('Google:');
  });
  
  it('should require a question', async () => {
    const result = await runCLI(['expert'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(3); // EXIT_CODES.INVALID_INPUT
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
    
    expect(result.exitCode).toBe(4); // EXIT_CODES.MISSING_API_KEY
    expect(result.stderr).toContain('API key');
  });
  
  it('should load preset for context', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/test.patterns': '**/*.ts',
      'src/index.ts': 'console.log("Test");'
    });
    
    // This will fail without API key, but we can check it processes the preset
    const result = await runCLI(['expert', 'Explain this', '--preset', 'test'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: ''
      }
    });
    
    // Should fail for API key after loading preset
    expect(result.stderr).toContain('API key');
  });
  
  
  
  it('should skip confirmation with --yes', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // This will still fail without API key, but won't ask for confirmation
    const result = await runCLI(['expert', 'Analyze this', '--model', 'o3-pro', '--yes'], { 
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
    
    // --yes flag should skip confirmation
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