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
  
  it('should install commands only by default (not CLAUDE.md)', async () => {
    const result = await runCLI(['cc'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Claude commands');
    expect(result.stdout).not.toContain('CLAUDE.md');
    
    // Check commands were created but not CLAUDE.md
    assertFileExists(path.join(fixture.dir, '.claude/commands/promptcode-ask-expert.md'));
    assertFileExists(path.join(fixture.dir, '.claude/.gitignore'));
    assertFileNotExists(path.join(fixture.dir, 'CLAUDE.md'));
  });
  
  it('should install both commands and CLAUDE.md with --with-docs flag', async () => {
    const result = await runCLI(['cc', '--with-docs'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Claude commands');
    
    // Check both files were created
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'), '<!-- PROMPTCODE-CLI-START -->');
    assertFileExists(path.join(fixture.dir, '.claude/commands/promptcode-ask-expert.md'));
    assertFileExists(path.join(fixture.dir, '.claude/.gitignore'));
  });
  
  it('should manage docs separately with docs subcommand', async () => {
    // First install commands
    await runCLI(['cc'], { cwd: fixture.dir });
    assertFileNotExists(path.join(fixture.dir, 'CLAUDE.md'));
    
    // Then add docs
    const result = await runCLI(['cc', 'docs', 'update'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('CLAUDE.md updated successfully');
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'), '<!-- PROMPTCODE-CLI-START -->');
  });
  
  it('should append to existing CLAUDE.md with docs update', async () => {
    createTestFiles(fixture.dir, {
      'CLAUDE.md': '# Existing Project Instructions\n\nThis is my project.'
    });
    
    // First install commands
    await runCLI(['cc'], { cwd: fixture.dir });
    
    // Then update docs
    const result = await runCLI(['cc', 'docs', 'update'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated PromptCode section');
    
    const content = fs.readFileSync(path.join(fixture.dir, 'CLAUDE.md'), 'utf8');
    expect(content).toContain('# Existing Project Instructions');
    expect(content).toContain('<!-- PROMPTCODE-CLI-START -->');
  });
  
  it('should show diff with docs diff command', async () => {
    createTestFiles(fixture.dir, {
      'CLAUDE.md': '# Test'
    });
    
    // Install commands first
    await runCLI(['cc'], { cwd: fixture.dir });
    
    const result = await runCLI(['cc', 'docs', 'diff'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('+++');
    expect(result.stdout).toContain('<!-- PROMPTCODE-CLI-START -->');
  });
  
  it('should check if docs need updating', async () => {
    // Install commands
    await runCLI(['cc'], { cwd: fixture.dir });
    
    // Check should fail (docs missing)
    const result1 = await runCLI(['cc', 'docs', 'check'], { cwd: fixture.dir });
    expect(result1.exitCode).toBe(1);
    expect(result1.stdout).toContain('needs updating');
    
    // Update docs
    await runCLI(['cc', 'docs', 'update'], { cwd: fixture.dir });
    
    // Check should pass
    const result2 = await runCLI(['cc', 'docs', 'check'], { cwd: fixture.dir });
    expect(result2.exitCode).toBe(0);
    expect(result2.stdout).toContain('up to date');
  });
  
  it('should update existing PromptCode section', async () => {
    createTestFiles(fixture.dir, {
      'CLAUDE.md': `# Project\n\n<!-- PROMPTCODE-CLI-START -->\nOld content\n<!-- PROMPTCODE-CLI-END -->\n\nMore content`
    });
    
    const result = await runCLI(['cc', '--with-docs'], { cwd: fixture.dir });
    
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
    const result = await runCLI(['cc', '--with-docs'], { cwd: subprojectDir });
    
    expect(result.exitCode).toBe(0);
    
    // Should update root CLAUDE.md, not create new one in subproject
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'), '<!-- PROMPTCODE-CLI-START -->');
    assertFileNotExists(path.join(subprojectDir, 'CLAUDE.md'));
  });
  
  it('should uninstall commands only by default', async () => {
    // First install with docs
    await runCLI(['cc', '--with-docs'], { cwd: fixture.dir });
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'));
    assertFileExists(path.join(fixture.dir, '.claude/commands/promptcode-ask-expert.md'));
    
    // Then uninstall (commands only)
    const result = await runCLI(['cc', 'uninstall'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed Claude commands');
    
    // Should remove commands but keep CLAUDE.md
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'));
    assertFileNotExists(path.join(fixture.dir, '.claude/commands/promptcode-ask-expert.md'));
  });
  
  it('should uninstall everything with --all flag', async () => {
    // First install with docs
    await runCLI(['cc', '--with-docs'], { cwd: fixture.dir });
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md'));
    assertFileExists(path.join(fixture.dir, '.claude/commands/promptcode-ask-expert.md'));
    
    // Then uninstall everything
    const result = await runCLI(['cc', 'uninstall', '--all'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed Claude commands');
    
    // Should remove commands and PromptCode section from CLAUDE.md (but keep the file)
    assertFileExists(path.join(fixture.dir, 'CLAUDE.md')); // File is preserved even if empty
    const content = fs.readFileSync(path.join(fixture.dir, 'CLAUDE.md'), 'utf8');
    expect(content).not.toContain('PROMPTCODE-CLI-START');
    assertFileNotExists(path.join(fixture.dir, '.claude/commands/promptcode-ask-expert.md'));
  });
  
  it('should handle uninstall with existing content', async () => {
    createTestFiles(fixture.dir, {
      'CLAUDE.md': `# My Project\n\n<!-- PROMPTCODE-CLI-START -->\nPromptCode stuff\n<!-- PROMPTCODE-CLI-END -->\n\n## Other Instructions`,
      '.claude/commands/promptcode-ask-expert.md': 'Expert command'
    });
    
    const result = await runCLI(['cc', 'uninstall', '--all'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    
    // Should keep CLAUDE.md but remove PromptCode section
    const content = fs.readFileSync(path.join(fixture.dir, 'CLAUDE.md'), 'utf8');
    expect(content).toContain('# My Project');
    expect(content).toContain('## Other Instructions');
    expect(content).not.toContain('PROMPTCODE-CLI-START');
    
    assertFileNotExists(path.join(fixture.dir, '.claude/commands/promptcode-ask-expert.md'));
  });
  
  it('should handle --yes flag', async () => {
    const result = await runCLI(['cc', '--yes'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    assertFileExists(path.join(fixture.dir, '.claude/commands/promptcode-ask-expert.md'));
    // Should not create CLAUDE.md by default
    assertFileNotExists(path.join(fixture.dir, 'CLAUDE.md'));
  });
  
  it('should support dry-run for docs', async () => {
    // Install commands first
    await runCLI(['cc'], { cwd: fixture.dir });
    
    const result = await runCLI(['cc', 'docs', 'update', '--dry-run'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dry-run');
    
    // Should not actually create the file
    assertFileNotExists(path.join(fixture.dir, 'CLAUDE.md'));
  });
});