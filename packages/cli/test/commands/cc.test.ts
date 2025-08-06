import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { createTestFixture, createTestFiles, runCLI, assertFileExists, assertFileNotExists } from '../test-utils';

describe('cc command', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  
  beforeEach(() => {
    fixture = createTestFixture('cc-test');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });
  
  it('should create new CLAUDE.md and .claude structure', async () => {
    const result = await runCLI(['cc'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated files');
    
    // Check files were created
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'), '<!-- PROMPTCODE-CLI-START -->');
    assertFileExists(path.join(fixture.dir, '.claude/commands/expert-consultation.md'));
    assertFileExists(path.join(fixture.dir, '.claude/.gitignore'));
  });
  
  it('should append to existing CLAUDE.md', async () => {
    createTestFiles(fixture.dir, {
      'CLAUDE.md': '# Existing Project Instructions\n\nThis is my project.'
    });
    
    const result = await runCLI(['cc'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Added PromptCode section to');
    
    const content = fs.readFileSync(path.join(fixture.dir, 'CLAUDE.md'), 'utf8');
    expect(content).toContain('# Existing Project Instructions');
    expect(content).toContain('<!-- PROMPTCODE-CLI-START -->');
  });
  
  it('should update existing PromptCode section', async () => {
    createTestFiles(fixture.dir, {
      'CLAUDE.md': `# Project\n\n<!-- PROMPTCODE-CLI-START -->\nOld content\n<!-- PROMPTCODE-CLI-END -->\n\nMore content`
    });
    
    const result = await runCLI(['cc'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated PromptCode section');
    
    const content = fs.readFileSync(path.join(fixture.dir, 'CLAUDE.md'), 'utf8');
    expect(content).not.toContain('Old content');
    expect(content).toContain('PromptCode CLI');
    expect(content).toContain('More content'); // Should preserve other content
  });
  
  it('should find .claude folder in parent directories', async () => {
    createTestFiles(fixture.dir, {
      '.claude/config.json': '{}',
      'CLAUDE.md': '# Root project',
      'packages/subproject/index.ts': 'export {}'
    });
    
    const subprojectDir = path.join(fixture.dir, 'packages/subproject');
    const result = await runCLI(['cc'], { cwd: subprojectDir });
    
    expect(result.exitCode).toBe(0);
    
    // Should update root CLAUDE.md, not create new one in subproject
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'), '<!-- PROMPTCODE-CLI-START -->');
    assertFileNotExists(path.join(subprojectDir, 'CLAUDE.md'));
  });
  
  it('should uninstall PromptCode integration', async () => {
    // First install
    await runCLI(['cc'], { cwd: fixture.dir });
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'));
    assertFileExists(path.join(fixture.dir, '.claude/commands/expert-consultation.md'));
    
    // Then uninstall
    const result = await runCLI(['cc', '--uninstall'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removing PromptCode CLI integration');
    
    // Should remove PromptCode section but keep file if it has other content
    assertFileNotExists(path.join(fixture.dir, 'CLAUDE.md')); // Was empty except for PromptCode
    assertFileNotExists(path.join(fixture.dir, '.claude/commands/expert-consultation.md'));
  });
  
  it('should handle uninstall with existing content', async () => {
    createTestFiles(fixture.dir, {
      'CLAUDE.md': `# My Project\n\n<!-- PROMPTCODE-CLI-START -->\nPromptCode stuff\n<!-- PROMPTCODE-CLI-END -->\n\n## Other Instructions`,
      '.claude/commands/expert-consultation.md': 'Expert command'
    });
    
    const result = await runCLI(['cc', '--uninstall'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    
    // Should keep CLAUDE.md but remove PromptCode section
    const content = fs.readFileSync(path.join(fixture.dir, 'CLAUDE.md'), 'utf8');
    expect(content).toContain('# My Project');
    expect(content).toContain('## Other Instructions');
    expect(content).not.toContain('PROMPTCODE-CLI-START');
    
    assertFileNotExists(path.join(fixture.dir, '.claude/commands/expert-consultation.md'));
  });
  
  it('should handle --yes flag', async () => {
    const result = await runCLI(['cc', '--yes'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'));
  });
});