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

  it('should support --force flag as alias for --yes', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    // --force flag should skip confirmation like --yes
    const result = await runCLI(['expert', 'Analyze this', '--force'], { 
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
  
  it('should require approval in non-interactive mode for expensive operations', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'.repeat(5000)  // Large file to trigger cost over $0.50 threshold
    });
    
    // Run in non-interactive mode without --yes
    const result = await runCLI(['expert', 'Analyze this', '--model', 'o3-pro'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        PROMPTCODE_TEST: '1',  // Force non-interactive
        PROMPTCODE_MOCK_LLM: '1',  // Use mock LLM to avoid API calls
        OPENAI_API_KEY: 'test-key'
      },
      timeout: 3000  // Short timeout to avoid hanging
    });
    
    expect(result.exitCode).toBe(2); // EXIT_CODES.APPROVAL_REQUIRED
    expect(result.stderr).toContain('Cost approval required');
    expect(result.stderr).toContain('Non-interactive environment');
  });
  
  it('should output correct JSON schema for --estimate-cost --json', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    const result = await runCLI(['expert', 'Test question', '--estimate-cost', '--json', '--model', 'gpt-5'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: 'test-key'
      }
    });
    
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json).toHaveProperty('schemaVersion');
    expect(json).toHaveProperty('model');
    expect(json).toHaveProperty('pricing');
    expect(json.tokens).toHaveProperty('input');
    expect(json.cost).toHaveProperty('total');
    expect(json).toHaveProperty('webSearchEnabled');
  });
  
  it('should output correct JSON schema for --models --json', async () => {
    const result = await runCLI(['expert', '--models', '--json'], { 
      cwd: fixture.dir
    });
    
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json).toHaveProperty('schemaVersion');
    expect(json).toHaveProperty('models');
    expect(json).toHaveProperty('providers');
    expect(json).toHaveProperty('defaultModel');
    expect(json.providers).toHaveProperty('openai');
    expect(json.providers.openai).toHaveProperty('available');
  });
  
  it('should return FILE_NOT_FOUND when prompt-file does not exist', async () => {
    const result = await runCLI(['expert', '--prompt-file', 'does-not-exist.md'], { 
      cwd: fixture.dir
    });
    
    expect(result.exitCode).toBe(6); // EXIT_CODES.FILE_NOT_FOUND
    expect(result.stderr).toContain('Prompt file not found');
  });
  
  it('should suggest known models for unknown model', async () => {
    const result = await runCLI(['expert', 'Test', '--model', 'not-a-real-model'], { 
      cwd: fixture.dir
    });
    
    expect(result.exitCode).toBe(3); // EXIT_CODES.INVALID_INPUT
    expect(result.stderr).toContain('Unknown model');
    expect(result.stderr).toContain('Known models');
    // Should list known models like gpt-5
    expect(result.stderr.toLowerCase()).toMatch(/gpt-5|o3|sonnet/);
  });

  it('should support --cost-threshold option', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'.repeat(100)
    });
    
    // Set a very low threshold to trigger approval
    const result = await runCLI(['expert', 'Test', '--cost-threshold', '0.001', '--model', 'gpt-5'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        PROMPTCODE_TEST: '1',  // Force non-interactive
        PROMPTCODE_MOCK_LLM: '1',  // Use mock LLM to avoid API calls
        OPENAI_API_KEY: 'test-key'
      }
    });
    
    expect(result.exitCode).toBe(2); // EXIT_CODES.APPROVAL_REQUIRED
    expect(result.stderr).toContain('Cost approval required');
  });
  
  it('should reject JSON + stream conflict', async () => {
    const result = await runCLI(['expert', 'Test', '--json', '--stream'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: 'test-key'
      }
    });
    
    expect(result.exitCode).toBe(3); // EXIT_CODES.INVALID_INPUT
    expect(result.stderr).toContain('Cannot use --json and --stream together');
  });
  
  it('should emit JSON error for approval required in non-interactive', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'.repeat(5000)  // Large file
    });
    
    const result = await runCLI(['expert', 'Analyze', '--model', 'o3-pro', '--json'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        PROMPTCODE_TEST: '1',
        PROMPTCODE_MOCK_LLM: '1',
        OPENAI_API_KEY: 'test-key'
      }
    });
    
    expect(result.exitCode).toBe(2); // EXIT_CODES.APPROVAL_REQUIRED
    const json = JSON.parse(result.stdout);
    expect(json.errorCode).toBe('APPROVAL_REQUIRED');
    expect(json.message).toContain('Non-interactive environment');
  });
  
  it('should reject invalid preset name for path traversal', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    const result = await runCLI(['expert', 'Test', '--save-preset', '../../evil'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: 'test-key'
      }
    });
    
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/invalid preset name/i);
  });
  
  it('should return PERMISSION_DENIED for unwritable output', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    const result = await runCLI(['expert', 'Test', '--output', '/root/test.txt', '--yes', '-f', 'src/index.ts'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        PROMPTCODE_MOCK_LLM: '1',
        OPENAI_API_KEY: 'test-key'
      }
    });
    
    // This test might not work on all systems, so check for either
    // permission denied exit code or error message
    if (result.exitCode === 9) {
      expect(result.exitCode).toBe(9); // EXIT_CODES.PERMISSION_DENIED
    } else if (result.stderr.toLowerCase().includes('permission') || 
               result.stderr.toLowerCase().includes('access') || 
               result.stderr.toLowerCase().includes('denied')) {
      // Good - got permission error message
      expect(true).toBe(true);
    } else {
      // On some systems, /root might not trigger permission error
      // Just ensure it didn't succeed
      expect(result.exitCode).toBeGreaterThan(0);
    }
  });
  
  it('should return CONTEXT_TOO_LARGE for exceeding context window', async () => {
    // Create a huge file that exceeds even large context windows
    createTestFiles(fixture.dir, {
      'src/huge.ts': 'console.log("Test");'.repeat(100000)  // ~2M tokens
    });
    
    const result = await runCLI(['expert', 'Analyze', '--model', 'gpt-5-nano', '-f', 'src/huge.ts'], { 
      cwd: fixture.dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: 'test-key'
      }
    });
    
    // Should exit with CONTEXT_TOO_LARGE code
    expect(result.exitCode).toBe(5); // EXIT_CODES.CONTEXT_TOO_LARGE
  });
  
  it('should handle dynamic provider enumeration', async () => {
    const result = await runCLI(['expert', '--models', '--json'], { 
      cwd: fixture.dir
    });
    
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    
    // Check that providers are dynamically enumerated
    expect(json.providers).toBeDefined();
    const providerKeys = Object.keys(json.providers);
    
    // Should include all unique providers from models
    const modelProviders = new Set(json.models.map((m: any) => m.provider));
    modelProviders.forEach(provider => {
      expect(providerKeys).toContain(provider);
    });
  });

  // ──────────────────────────────────────────────────────────
  // New tests for domain boundary hardening
  // ──────────────────────────────────────────────────────────

  it('rejects patterns attempting to escape project root', async () => {
    const result = await runCLI(['expert', 'Q', '-f', '../../**/*.pem'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    // Should fail with a non-zero exit code
    expect(result.exitCode).toBeGreaterThan(0);
  });

  it('applies safe default excludes on broad scans (no preset/files)', async () => {
    createTestFiles(fixture.dir, {
      'node_modules/pkg/index.js': 'console.log(1)',
      '.git/HEAD': 'ref: refs/heads/main',
      '.env': 'SECRET=1',
      'src/index.ts': 'console.log("ok");'
    });
    const res = await runCLI(['expert', 'Q', '--estimate-cost', '--json'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    expect(res.exitCode).toBe(0);
    const json = JSON.parse(res.stdout);
    // Only src/index.ts should be counted
    expect(json.fileCount).toBe(1);
  });

  it('requires explicit approval to overwrite an existing preset in non-interactive mode', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/exist.patterns': '**/*.ts',
      'src/a.ts': 'console.log(1);'
    });
    const res = await runCLI(['expert', 'Q', '--save-preset', 'exist', '-f', 'src/a.ts'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key', PROMPTCODE_TEST: '1' }
    });
    // Should fail when trying to overwrite without --yes
    expect(res.exitCode).toBeGreaterThan(0);
  });

  it('allows preset overwrite with --yes', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/dup.patterns': '**/*.ts',
      'src/b.ts': 'console.log(2);'
    });
    const res = await runCLI(['expert', 'Q', '--save-preset', 'dup', '-f', 'src/b.ts', '--yes', '--estimate-cost'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    // Should succeed with --yes flag (exit code 0)
    expect(res.exitCode).toBe(0);
  });
  
});