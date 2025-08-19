import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { resolveProjectPath } from '../src/utils/paths';
import * as os from 'os';

describe('resolveProjectPath', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    // Create temp directory in system temp folder
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-test-'));
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ascends to project root when .promptcode is present', () => {
    const root = path.join(tempDir, 'repo');
    const sub = path.join(root, 'packages', 'cli', 'src');
    fs.mkdirSync(path.join(root, '.promptcode'), { recursive: true });
    fs.mkdirSync(sub, { recursive: true });

    process.chdir(sub);
    const resolved = resolveProjectPath();
    // Use fs.realpathSync to handle symlink differences on macOS
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(root));
  });

  it('returns startPath when .promptcode is absent', () => {
    const sub = path.join(tempDir, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    const resolved = resolveProjectPath(sub);
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(sub));
  });

  it('finds .promptcode in parent directories', () => {
    const root = path.join(tempDir, 'project');
    const deep = path.join(root, 'very', 'deep', 'nested', 'folder');
    
    // Create .promptcode at root
    fs.mkdirSync(path.join(root, '.promptcode'), { recursive: true });
    fs.mkdirSync(deep, { recursive: true });
    
    // Test from deep directory
    process.chdir(deep);
    const resolved = resolveProjectPath();
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(root));
  });

  it('stops at filesystem root if no .promptcode found', () => {
    const orphan = path.join(tempDir, 'orphan');
    fs.mkdirSync(orphan, { recursive: true });
    
    process.chdir(orphan);
    const resolved = resolveProjectPath();
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(orphan));
  });

  it('respects explicit path option over cwd', () => {
    const projectA = path.join(tempDir, 'projectA');
    const projectB = path.join(tempDir, 'projectB');
    
    fs.mkdirSync(path.join(projectA, '.promptcode'), { recursive: true });
    fs.mkdirSync(path.join(projectB, '.promptcode'), { recursive: true });
    
    // Change to projectA but resolve projectB
    process.chdir(projectA);
    const resolved = resolveProjectPath(projectB);
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(projectB));
  });
});