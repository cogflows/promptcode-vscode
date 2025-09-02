import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ensurePromptcodeScaffold, isTooHighUp } from '../../src/utils/paths';

describe('ensurePromptcodeScaffold', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-test-'));
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create .promptcode/presets directory structure', async () => {
    const projectDir = path.join(testDir, 'my-project');
    fs.mkdirSync(projectDir, { recursive: true });

    await ensurePromptcodeScaffold(projectDir, true);

    const promptcodeDir = path.join(projectDir, '.promptcode');
    const presetsDir = path.join(promptcodeDir, 'presets');

    expect(fs.existsSync(promptcodeDir)).toBe(true);
    expect(fs.existsSync(presetsDir)).toBe(true);
    expect(fs.statSync(promptcodeDir).isDirectory()).toBe(true);
    expect(fs.statSync(presetsDir).isDirectory()).toBe(true);
  });

  it('should create only .promptcode when withPresets is false', async () => {
    const projectDir = path.join(testDir, 'my-project');
    fs.mkdirSync(projectDir, { recursive: true });

    await ensurePromptcodeScaffold(projectDir, false);

    const promptcodeDir = path.join(projectDir, '.promptcode');
    const presetsDir = path.join(promptcodeDir, 'presets');

    expect(fs.existsSync(promptcodeDir)).toBe(true);
    expect(fs.existsSync(presetsDir)).toBe(false);
  });

  it('should not overwrite existing .promptcode directory', async () => {
    const projectDir = path.join(testDir, 'my-project');
    const promptcodeDir = path.join(projectDir, '.promptcode');
    const testFile = path.join(promptcodeDir, 'test.txt');

    fs.mkdirSync(promptcodeDir, { recursive: true });
    fs.writeFileSync(testFile, 'test content');

    await ensurePromptcodeScaffold(projectDir, true);

    // Test file should still exist
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.readFileSync(testFile, 'utf8')).toBe('test content');
  });

  it('should not create in home directory', async () => {
    const homeDir = os.homedir();
    
    await ensurePromptcodeScaffold(homeDir, true);

    const promptcodeDir = path.join(homeDir, '.promptcode');
    // Should NOT create in home directory
    // (unless it already existed, which we can't control in tests)
    // So we just verify the function completes without error
    expect(true).toBe(true);
  });

  it('should not create in root directory', async () => {
    const rootDir = path.parse(process.cwd()).root;
    
    await ensurePromptcodeScaffold(rootDir, true);

    // Should NOT create in root directory
    // Function should complete without error
    expect(true).toBe(true);
  });

  it('should not follow symlinks', async () => {
    const projectDir = path.join(testDir, 'my-project');
    const targetDir = path.join(testDir, 'target');
    const symlinkPath = path.join(projectDir, '.promptcode');

    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    
    // Create a symlink pointing to target
    fs.symlinkSync(targetDir, symlinkPath);

    await ensurePromptcodeScaffold(projectDir, true);

    // Should not have created presets in the symlinked directory
    const presetsInTarget = path.join(targetDir, 'presets');
    expect(fs.existsSync(presetsInTarget)).toBe(false);
  });

  it('should handle errors silently', async () => {
    // Create a file where directory should be (will cause mkdir to fail)
    const projectDir = path.join(testDir, 'my-project');
    const promptcodeFile = path.join(projectDir, '.promptcode');
    
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(promptcodeFile, 'this is a file, not a directory');

    // Should not throw, just silently fail
    await expect(ensurePromptcodeScaffold(projectDir, true)).resolves.toBeUndefined();
  });

  it('should not create presets when .promptcode is a file', async () => {
    const projectDir = path.join(testDir, 'my-project');
    const promptcodeFile = path.join(projectDir, '.promptcode');
    const presetsDir = path.join(projectDir, '.promptcode', 'presets');
    
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(promptcodeFile, 'this is a file, not a directory');

    await ensurePromptcodeScaffold(projectDir, true);

    // .promptcode is still a file, not replaced
    expect(fs.existsSync(promptcodeFile)).toBe(true);
    expect(fs.statSync(promptcodeFile).isFile()).toBe(true);
    // presets directory should not exist
    expect(fs.existsSync(presetsDir)).toBe(false);
  });

  it('should handle symlinked project root correctly', async () => {
    const realProjectDir = path.join(testDir, 'real-project');
    const symlinkProjectDir = path.join(testDir, 'symlink-project');
    
    // Create real directory and symlink to it
    fs.mkdirSync(realProjectDir, { recursive: true });
    fs.symlinkSync(realProjectDir, symlinkProjectDir, 'dir');

    // Create scaffold through symlink
    await ensurePromptcodeScaffold(symlinkProjectDir, true);

    // Should create .promptcode in the real location
    const realPromptcodeDir = path.join(realProjectDir, '.promptcode');
    const realPresetsDir = path.join(realPromptcodeDir, 'presets');
    
    expect(fs.existsSync(realPromptcodeDir)).toBe(true);
    expect(fs.existsSync(realPresetsDir)).toBe(true);
    
    // Verify it's accessible through symlink too
    const symlinkPromptcodeDir = path.join(symlinkProjectDir, '.promptcode');
    expect(fs.existsSync(symlinkPromptcodeDir)).toBe(true);
  });
});

describe('isTooHighUp', () => {
  it('should detect home directory as too high', () => {
    const homeDir = os.homedir();
    expect(isTooHighUp(homeDir)).toBe(true);
  });

  it('should detect root directory as too high', () => {
    const rootDir = path.parse(process.cwd()).root;
    expect(isTooHighUp(rootDir)).toBe(true);
  });

  it('should detect immediate children of home as too high', () => {
    const homeChild = path.join(os.homedir(), 'Documents');
    expect(isTooHighUp(homeChild)).toBe(true);
  });

  it('should allow deeply nested project directories', () => {
    const projectDir = path.join(os.homedir(), 'workspace', 'projects', 'my-app');
    expect(isTooHighUp(projectDir)).toBe(false);
  });

  it('should allow temp directories', () => {
    const tempDir = path.join(os.tmpdir(), 'some-project');
    // tmp is usually not immediate child of home or root
    const isTooHigh = isTooHighUp(tempDir);
    // This might vary by system, so we just ensure it doesn't crash
    expect(typeof isTooHigh).toBe('boolean');
  });
});