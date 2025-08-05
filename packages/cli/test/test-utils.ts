import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

export interface TestFixture {
  dir: string;
  cleanup: () => void;
}

/**
 * Create a temporary test directory with cleanup
 */
export function createTestFixture(prefix: string = 'promptcode-test'): TestFixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        console.error(`Failed to cleanup test directory ${dir}:`, error);
      }
    }
  };
}

/**
 * Create test files in a directory
 */
export function createTestFiles(dir: string, files: Record<string, string>): void {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    const dirname = path.dirname(fullPath);
    
    // Create directory if needed
    if (!fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content);
  }
}

/**
 * Run CLI command and capture output
 */
export async function runCLI(
  args: string[], 
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(__dirname, '..', 'dist', 'promptcode');
    const child = spawn(cliPath, args, {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        CI: 'true',           // always indicate CI
        NO_COLOR: '1',        // avoid color codes in test output
        PROMPTCODE_TEST: '1', // flag for CLI to detect test mode
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'], // no stdin to prevent hanging
      detached: process.platform !== 'win32' // own process group for proper cleanup (not on Windows)
    });
    
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    
    // Set timeout if provided
    const timeout = options.timeout || 30000; // Default 30s timeout
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the entire process group to clean up any child processes
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM'); // negative pid = kill process group
        } catch (e) {
          // Fallback to regular kill if group kill fails
          child.kill('SIGTERM');
        }
      }
      reject(new Error(`Command timed out after ${timeout}ms: ${args.join(' ')}`));
    }, timeout);
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!timedOut) {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0
        });
      }
    });
    
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!timedOut) {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0
        });
      }
    });
  });
}

/**
 * Assert file exists with content
 */
export function assertFileExists(filePath: string, expectedContent?: string | RegExp): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected file to exist: ${filePath}`);
  }
  
  if (expectedContent) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (typeof expectedContent === 'string') {
      if (!content.includes(expectedContent)) {
        throw new Error(`File ${filePath} does not contain expected content: ${expectedContent}`);
      }
    } else {
      if (!expectedContent.test(content)) {
        throw new Error(`File ${filePath} does not match expected pattern: ${expectedContent}`);
      }
    }
  }
}

/**
 * Assert file does not exist
 */
export function assertFileNotExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    throw new Error(`Expected file not to exist: ${filePath}`);
  }
}

/**
 * Create a mock API server for testing
 */
export function createMockAPIServer(port: number = 0): {
  url: string;
  close: () => void;
  setResponse: (response: any) => void;
} {
  // For now, return a simple mock
  // In a real implementation, this would start an actual HTTP server
  return {
    url: `http://localhost:${port || 3000}`,
    close: () => {},
    setResponse: () => {}
  };
}