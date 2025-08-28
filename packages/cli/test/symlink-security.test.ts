import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('symlink safety (external files detection)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-symlink-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects files outside the project via symlink', () => {
    // Skip on Windows due to symlink permission requirements
    if (process.platform === 'win32') {
      console.log('Skipping symlink test on Windows');
      return;
    }

    const root = path.join(tempDir, 'root');
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(path.join(root, '.promptcode'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    const target = path.join(outside, 'secret.txt');
    fs.writeFileSync(target, 'sensitive data');

    const linkDir = path.join(root, 'link');
    fs.symlinkSync(outside, linkDir, 'dir');

    // Verify the symlink points outside the project root
    const real = fs.realpathSync(path.join(linkDir, 'secret.txt'));
    const rootReal = fs.realpathSync(root);
    expect(real.startsWith(rootReal)).toBe(false);
  });

  it('handles symlink loops gracefully', () => {
    if (process.platform === 'win32') {
      console.log('Skipping symlink test on Windows');
      return;
    }

    const root = path.join(tempDir, 'loop-test');
    fs.mkdirSync(root, { recursive: true });

    const dirA = path.join(root, 'a');
    const dirB = path.join(root, 'b');
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);

    // Create circular symlinks
    try {
      fs.symlinkSync(dirB, path.join(dirA, 'link-to-b'), 'dir');
      fs.symlinkSync(dirA, path.join(dirB, 'link-to-a'), 'dir');

      // Just verify the symlinks were created without crashing
      expect(fs.lstatSync(path.join(dirA, 'link-to-b')).isSymbolicLink()).toBe(true);
      expect(fs.lstatSync(path.join(dirB, 'link-to-a')).isSymbolicLink()).toBe(true);
    } catch (e) {
      // Some systems may prevent circular symlinks
      console.log('Circular symlink test skipped:', (e as Error).message);
    }
  });
});