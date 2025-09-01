import { spawnSync, spawn, SpawnSyncOptions, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run CLI in isolated mode without forcing PROMPTCODE_TEST=1
 * This allows testing features that are disabled in test mode
 */
export function runCLIIsolated(
  args: string[],
  options: SpawnSyncOptions = {}
): ReturnType<typeof spawnSync> {
  const cliPath = path.join(__dirname, '..', '..', 'dist', 'promptcode');
  
  // Check if compiled binary exists
  if (!fs.existsSync(cliPath)) {
    throw new Error('CLI binary not found. Run "bun run build" first.');
  }
  
  return spawnSync(cliPath, args, {
    encoding: 'utf8',
    ...options,
    env: {
      ...process.env,
      // Don't force test mode - let the test decide
      PROMPTCODE_TEST: undefined,
      PROMPTCODE_SKIP_FINALIZE: '1', // But skip actual finalization for safety
      ...options.env
    }
  });
}

/**
 * Run CLI in standard test mode
 */
export function runCLI(
  args: string[],
  options: SpawnSyncOptions = {}
): ReturnType<typeof spawnSync> {
  const cliPath = path.join(__dirname, '..', '..', 'dist', 'promptcode');
  
  if (!fs.existsSync(cliPath)) {
    throw new Error('CLI binary not found. Run "bun run build" first.');
  }
  
  return spawnSync(cliPath, args, {
    encoding: 'utf8',
    ...options,
    env: {
      ...process.env,
      PROMPTCODE_TEST: '1',
      CI: 'true',
      ...options.env
    }
  });
}

/**
 * Run CLI asynchronously for testing long-running processes
 */
export function runCLIAsync(
  args: string[],
  options: any = {}
): ChildProcess {
  const cliPath = path.join(__dirname, '..', '..', 'dist', 'promptcode');
  
  if (!fs.existsSync(cliPath)) {
    throw new Error('CLI binary not found. Run "bun run build" first.');
  }
  
  return spawn(cliPath, args, {
    ...options,
    env: {
      ...process.env,
      PROMPTCODE_TEST: '1',
      CI: 'true',
      ...options.env
    }
  });
}

/**
 * Get the path to the CLI binary being tested
 */
export function getCLIBinaryPath(): string {
  return path.join(__dirname, '..', '..', 'dist', 'promptcode');
}

/**
 * Create a temporary directory for testing
 */
export function createTempDir(prefix: string = 'promptcode-test-'): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return tmpDir;
}

/**
 * Clean up a temporary directory
 */
export function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}