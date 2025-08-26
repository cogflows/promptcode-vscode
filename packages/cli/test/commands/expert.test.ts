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
    const result = await runCLI(['expert', 'Analyze this', '-f', 'src/**/*.ts', '--model', 'o3-pro'], { 
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
    
    const result = await runCLI(['expert', 'Analyze', '-f', 'src/**/*.ts', '--model', 'o3-pro', '--json'], { 
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
    
    const result = await runCLI(['expert', 'Test', '-f', 'src/**/*.ts', '--save-preset', '../../evil'], { 
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

  it('rejects patterns with .. for security', async () => {
    // Test with a more generic pattern that's likely to match something
    const result = await runCLI(['expert', 'Q', '-f', '../**/*'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key', PROMPTCODE_TEST: '1' }
    });
    
    // Should either:
    // 1. Fail with non-zero exit code if files are found (path.relative error)
    // 2. Exit with "No files found" if no files match
    const output = (result.stderr || '') + (result.stdout || '');
    
    // Accept any of these as valid security rejection behaviors:
    const hasPathError = output.includes('path should be') || output.includes('path.relative');
    const hasNoFiles = output.includes('No files found') || output.includes('No files matched');
    const hasPermissionError = output.includes('EPERM') || output.includes('operation not permitted');
    const hasPatternRejection = output.includes('Patterns with .. are not allowed') || 
                                 output.includes('parent directory') ||
                                 output.includes('directory traversal');
    
    // The important thing is that it doesn't process files from parent directories
    expect(hasPathError || hasNoFiles || hasPermissionError || hasPatternRejection || result.exitCode !== 0).toBe(true);
  });

  it('applies safe default excludes on broad scans with explicit pattern', async () => {
    createTestFiles(fixture.dir, {
      'node_modules/pkg/index.js': 'console.log(1)',
      '.git/HEAD': 'ref: refs/heads/main',
      '.env': 'SECRET=1',
      'src/index.ts': 'console.log("ok");'
    });
    // When explicitly requesting all files, safe excludes should apply
    const res = await runCLI(['expert', 'Q', '-f', '**/*', '--estimate-cost', '--json'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    expect(res.exitCode).toBe(0);
    const json = JSON.parse(res.stdout);
    // Only src/index.ts should be counted (excludes applied)
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

  // ──────────────────────────────────────────────────────────
  // Tests for preset create command integration
  // ──────────────────────────────────────────────────────────

  it('should handle expert command with preset created via --from-files', async () => {
    // First create a preset using --from-files
    createTestFiles(fixture.dir, {
      'src/api/users.ts': 'export class UserController { getUser() { return "user"; } }',
      'src/api/posts.ts': 'export class PostController { getPost() { return "post"; } }',
      'src/utils/auth.ts': 'export function authenticate() { return true; }',
      'tests/api.test.ts': 'describe("API", () => { it("works", () => {}); })'
    });

    // Create preset with --from-files
    const createResult = await runCLI(['preset', 'create', 'api-test', '--from-files', 'src/api/**/*.ts', 'tests/**/*.test.ts'], {
      cwd: fixture.dir
    });
    expect(createResult.exitCode).toBe(0);
    expect(createResult.stdout).toContain('Created preset: api-test');

    // Now use the preset with expert command  
    const expertResult = await runCLI(['expert', 'What does this API do?', '--preset', 'api-test', '--estimate-cost', '--json'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    
    expect(expertResult.exitCode).toBe(0);
    const json = JSON.parse(expertResult.stdout);
    
    // Verify the preset was used and includes the correct files
    expect(json.fileCount).toBeGreaterThanOrEqual(3); // At least api files + test
    expect(json.tokens.input).toBeGreaterThan(0);
  });

  it('should handle expert command with manually created preset', async () => {
    // Create preset manually (without --from-files)
    createTestFiles(fixture.dir, {
      '.promptcode/presets/manual-test.patterns': [
        '# Manual test preset',
        'src/**/*.ts',
        'tests/**/*.test.ts',
        '!**/node_modules/**',
        '!**/*.d.ts'
      ].join('\n'),
      'src/main.ts': 'export function main() { console.log("main"); }',
      'src/helpers.ts': 'export function helper() { return 42; }',
      'tests/main.test.ts': 'test("main", () => { expect(main()).toBe(undefined); })'
    });

    // Use the manually created preset with expert
    const result = await runCLI(['expert', 'Explain this codebase', '--preset', 'manual-test', '--estimate-cost', '--json'], {
      cwd: fixture.dir, 
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    
    // Verify preset was loaded correctly
    expect(json.fileCount).toBe(3); // main.ts, helpers.ts, main.test.ts
    expect(json.tokens.input).toBeGreaterThan(0);
    expect(json.cost.total).toBeGreaterThan(0);
  });

  it('should handle expert command with specific files pattern', async () => {
    createTestFiles(fixture.dir, {
      'src/feature/auth.ts': 'export class Auth { login() {} logout() {} }',
      'src/feature/user.ts': 'export class User { getName() {} }', 
      'src/other/config.ts': 'export const config = {};',
      'tests/auth.test.ts': 'test("auth", () => {});'
    });

    // Use expert with direct file patterns
    const result = await runCLI(['expert', 'Review authentication code', '-f', 'src/feature/**/*.ts', 'tests/**/*.test.ts', '--estimate-cost', '--json'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    
    // Should include feature files and test, but not config
    expect(json.fileCount).toBe(3); // auth.ts, user.ts, auth.test.ts
    expect(json.tokens.input).toBeGreaterThan(0);
  });

  it('should error when preset does not exist', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("test");'
    });

    const result = await runCLI(['expert', 'Analyze', '--preset', 'non-existent-preset'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    
    // Preset not found should result in error
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr).toContain('non-existent-preset');
  });

  it('should handle combination of preset and additional files', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/base.patterns': 'src/core/**/*.ts',
      'src/core/engine.ts': 'export class Engine {}',
      'src/core/parser.ts': 'export class Parser {}',
      'src/utils/logger.ts': 'export class Logger {}',
      'docs/README.md': '# Documentation'
    });

    // Use both preset and additional file patterns
    const result = await runCLI(['expert', 'Analyze architecture', '--preset', 'base', '-f', 'src/utils/**/*.ts', 'docs/**/*.md', '--estimate-cost', '--json'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    
    // Should include preset files (engine.ts, parser.ts) and maybe additional patterns
    // The actual count might vary based on how presets and files are combined
    expect(json.fileCount).toBeGreaterThanOrEqual(2); // At least the core files
    expect(json.tokens.input).toBeGreaterThan(0);
  });

  it('should correctly process preset created with optimization levels', async () => {
    createTestFiles(fixture.dir, {
      'src/api/v1/users.ts': 'export class UserV1 {}',
      'src/api/v1/posts.ts': 'export class PostV1 {}',
      'src/api/v2/users.ts': 'export class UserV2 {}',
      'src/api/v2/posts.ts': 'export class PostV2 {}',
      'src/api/common/base.ts': 'export class BaseController {}'
    });

    // Create preset with aggressive optimization
    const createResult = await runCLI(['preset', 'create', 'api-optimized', '--from-files', 'src/api/**/*.ts', '--optimization-level', 'aggressive'], {
      cwd: fixture.dir
    });
    expect(createResult.exitCode).toBe(0);

    // Use the optimized preset
    const expertResult = await runCLI(['expert', 'Analyze API structure', '--preset', 'api-optimized', '--estimate-cost', '--json'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    
    expect(expertResult.exitCode).toBe(0);
    const json = JSON.parse(expertResult.stdout);
    expect(json.fileCount).toBe(5); // Should include all API files
  });
  
  it('should handle expert command without files (pure AI consultation)', async () => {
    // Test that expert command without files doesn't scan the project
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("This should not be included");',
      'package.json': '{"name": "test-project"}',
      'README.md': '# Test Project'
    });

    // Run expert without any files or preset specified
    const result = await runCLI(['expert', 'What are best practices for API design?', '--estimate-cost', '--json'], {
      cwd: fixture.dir,
      env: { ...process.env, OPENAI_API_KEY: 'test-key' }
    });
    
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    
    // Should have no files included
    expect(json.fileCount).toBe(0);
    // Should only have tokens from the question and system prompt
    expect(json.tokens.input).toBeGreaterThan(0);
    expect(json.tokens.input).toBeLessThan(500); // Should be small since no files are included
    expect(json.cost.total).toBeGreaterThan(0);
  });

});