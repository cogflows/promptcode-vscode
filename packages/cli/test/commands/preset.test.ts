import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'path';
import { createTestFixture, createTestFiles, runCLI, assertFileExists, assertFileNotExists } from '../test-utils';

describe('preset command', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  
  beforeEach(() => {
    fixture = createTestFixture('preset-test');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });
  
  it('should list presets', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/backend.patterns': '# Backend files\n**/*.ts',
      '.promptcode/presets/frontend.patterns': '# Frontend files\n**/*.tsx\n**/*.jsx'
    });
    
    const result = await runCLI(['preset', 'list'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('backend');
    expect(result.stdout).toContain('frontend');
    expect(result.stdout).toContain('2 patterns');
  });
  
  it('should show preset info with usage examples', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/api.patterns': '# API files\nsrc/api/**/*.ts\n!**/*.test.ts',
      'src/api/users.ts': 'export const getUsers = () => [];',
      'src/api/posts.ts': 'export const getPosts = () => [];'
    });
    
    const result = await runCLI(['preset', 'info', 'api'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Preset: api');
    expect(result.stdout).toContain('Files matched: 2');
    expect(result.stdout).toContain('src/api/**/*.ts');
    expect(result.stdout).toContain('Usage Examples:');
    expect(result.stdout).toContain('promptcode generate --preset api');
    expect(result.stdout).toContain('promptcode expert "Explain the architecture" --preset api');
  });
  
  it('should create new preset', async () => {
    const result = await runCLI(['preset', 'create', 'test-preset'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created preset: test-preset');
    
    const presetPath = path.join(fixture.dir, '.promptcode/presets/test-preset.patterns');
    assertFileExists(presetPath, '# test-preset preset');
    assertFileExists(presetPath, '**/*.ts');
  });
  
  it('should delete preset', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/temp.patterns': '# Temp preset\n**/*.tmp'
    });
    
    const presetPath = path.join(fixture.dir, '.promptcode/presets/temp.patterns');
    assertFileExists(presetPath);
    
    const result = await runCLI(['preset', 'delete', 'temp'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Deleted preset: temp');
    assertFileNotExists(presetPath);
  });
  
  it('should search presets by content', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/backend.patterns': '# Backend API files\nsrc/api/**/*.ts',
      '.promptcode/presets/frontend.patterns': '# Frontend UI components\nsrc/components/**/*.tsx',
      '.promptcode/presets/tests.patterns': '# Test files\n**/*.test.ts\n**/*.spec.ts'
    });
    
    const result = await runCLI(['preset', 'search', 'api'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('backend');
    expect(result.stdout).toContain('Backend API files');
    expect(result.stdout).not.toContain('frontend'); // Should not match
  });
  
  it('should handle missing preset gracefully', async () => {
    const result = await runCLI(['preset', 'info', 'nonexistent'], { cwd: fixture.dir });
    
    // Exit code is 0 even for missing preset (graceful handling)
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Preset not found: nonexistent');
  });
  
  it('should edit preset in non-interactive mode', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/edit-test.patterns': '# Original content\n**/*.js'
    });
    
    const result = await runCLI(['preset', 'edit', 'edit-test'], { 
      cwd: fixture.dir,
      env: { ...process.env, CI: 'true' } // Simulate non-interactive
    });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Non-interactive environment detected');
    expect(result.stdout).toContain('Current patterns:');
    expect(result.stdout).toContain('**/*.js');
  });
});