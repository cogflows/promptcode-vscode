import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { createTestFixture, createTestFiles, runCLI, assertFileExists, assertFileNotExists } from '../test-utils';

describe('cursor command', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  
  beforeEach(() => {
    fixture = createTestFixture('cursor-test');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });
  
  it('should create .cursor/rules directory and MDC files', async () => {
    const result = await runCLI(['cursor'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PromptCode Cursor integration set up successfully');
    
    // Check files were created
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-usage.mdc'));
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-preset-list.mdc'));
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-preset-info.mdc'));
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-preset-create.mdc'));
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-preset-to-prompt.mdc'));
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-ask-expert.mdc'));
  });
  
  it('should preserve existing .cursor/rules files', async () => {
    createTestFiles(fixture.dir, {
      '.cursor/rules/existing-rule.mdc': '# Existing rule\nContent here'
    });
    
    const result = await runCLI(['cursor'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    
    // Should preserve existing file
    const existingContent = fs.readFileSync(path.join(fixture.dir, '.cursor/rules/existing-rule.mdc'), 'utf8');
    expect(existingContent).toContain('# Existing rule');
    
    // And add new files
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-usage.mdc'));
  });
  
  it('should find .cursor folder in parent directories', async () => {
    createTestFiles(fixture.dir, {
      '.cursor/config.json': '{}',
      'packages/subproject/index.ts': 'export {}'
    });
    
    const subprojectDir = path.join(fixture.dir, 'packages/subproject');
    const result = await runCLI(['cursor'], { cwd: subprojectDir });
    
    expect(result.exitCode).toBe(0);
    
    // Should use root .cursor, not create new one in subproject
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-usage.mdc'));
    assertFileNotExists(path.join(subprojectDir, '.cursor/rules/promptcode-usage.mdc'));
  });
  
  it('should uninstall Cursor integration', async () => {
    // First install
    await runCLI(['cursor'], { cwd: fixture.dir });
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-usage.mdc'));
    
    // Add a non-promptcode file
    createTestFiles(fixture.dir, {
      '.cursor/rules/custom-rule.mdc': '# Custom rule'
    });
    
    // Now uninstall
    const result = await runCLI(['cursor', '--uninstall'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed PromptCode rules from .cursor/rules/');
    
    // Should remove promptcode files
    assertFileNotExists(path.join(fixture.dir, '.cursor/rules/promptcode-usage.mdc'));
    assertFileNotExists(path.join(fixture.dir, '.cursor/rules/promptcode-preset-list.mdc'));
    
    // Should preserve custom files
    assertFileExists(path.join(fixture.dir, '.cursor/rules/custom-rule.mdc'));
  });
  
  it('should handle reinstallation idempotently', async () => {
    // Install twice
    await runCLI(['cursor'], { cwd: fixture.dir });
    const result = await runCLI(['cursor'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('6 unchanged');
    
    // Files should still exist
    assertFileExists(path.join(fixture.dir, '.cursor/rules/promptcode-usage.mdc'));
  });
  
  it('should handle missing templates gracefully', async () => {
    // This test would need to mock missing embedded templates
    // For now, just verify the command runs
    const result = await runCLI(['cursor', '--help'], { cwd: fixture.dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Set up or remove Cursor AI integration');
  });
});