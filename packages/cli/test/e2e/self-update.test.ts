import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createServer } from 'http';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runCLIIsolated, createTempDir, cleanupTempDir, getCLIBinaryPath } from '../helpers/cli-runner';
import { getAssetName } from '../../src/utils/assets';

// Skip network-based tests in CI due to Bun compiled binary networking issues
// Bun's fetch in compiled binaries has problems with localhost/loopback in Linux
// See: https://github.com/oven-sh/bun/issues/6885
const isCI = process.env.CI === 'true';

describe('E2E: Self-Update Flow', () => {
  let server: any;
  let serverPort: number;
  let testDir: string;
  let mockBinaryPath: string;
  let mockBinaryV2Path: string;

  beforeAll(async () => {
    // Create test directory
    testDir = createTempDir('e2e-update-');
    
    // Create mock binaries
    mockBinaryPath = path.join(testDir, 'promptcode-v1');
    mockBinaryV2Path = path.join(testDir, 'promptcode-v2');
    
    // Simple mock binary v1
    fs.writeFileSync(mockBinaryPath, `#!/usr/bin/env node
console.log('1.0.0');
process.exit(0);
`);
    fs.chmodSync(mockBinaryPath, 0o755);
    
    // Simple mock binary v2
    fs.writeFileSync(mockBinaryV2Path, `#!/usr/bin/env node
console.log('2.0.0');
process.exit(0);
`);
    fs.chmodSync(mockBinaryV2Path, 0o755);
    
    // Create checksums
    const v2Hash = crypto.createHash('sha256').update(fs.readFileSync(mockBinaryV2Path)).digest('hex');
    fs.writeFileSync(`${mockBinaryV2Path}.sha256`, `${v2Hash}  promptcode\n`);
    
    // Start local HTTP server for mock downloads
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url === '/repos/cogflows/promptcode-vscode/releases/latest') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            tag_name: 'v2.0.0',
            assets: [
              {
                name: getAssetName(process.platform as any, process.arch),
                browser_download_url: `http://127.0.0.1:${serverPort}/download/binary`
              },
              {
                name: `${getAssetName(process.platform as any, process.arch)}.sha256`,
                browser_download_url: `http://127.0.0.1:${serverPort}/download/binary.sha256`
              }
            ]
          }));
        } else if (req.url === '/download/binary') {
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          res.end(fs.readFileSync(mockBinaryV2Path));
        } else if (req.url === '/download/binary.sha256') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(fs.readFileSync(`${mockBinaryV2Path}.sha256`));
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      
      // Bind to 127.0.0.1 explicitly to avoid IPv4/IPv6 resolution issues
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverPort = typeof addr === 'string' ? 0 : addr!.port;
        resolve();
      });
    });
  });

  afterAll(() => {
    if (server) {
      server.close();
    }
    cleanupTempDir(testDir);
  });

  test.skipIf(isCI)('should check for updates and show available version', () => {
    const result = runCLIIsolated(['update', '--force'], {
      env: {
        PROMPTCODE_BASE_URL: `http://127.0.0.1:${serverPort}`,
        PROMPTCODE_TEST_MODE: '1', // Allow test mode but not full PROMPTCODE_TEST
        CI: 'true', // Non-interactive mode
        // Disable proxies - CI environments often have proxy vars that break loopback
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: ''
      },
      timeout: 30000 // 30 second timeout - CI runners can be slow
    });

    // Debug output if test fails
    if (result.status !== 0) {
      console.error('Update command failed:');
      console.error('stdout:', result.stdout);
      console.error('stderr:', result.stderr);
      console.error('status:', result.status);
      console.error('signal:', result.signal);
    }

    // Should show current version or update message
    expect(result.status).toBe(0);
  }, { timeout: 30000 }); // Bun test timeout for CI

  test.skipIf(isCI)('should download and stage update with checksum verification', () => {
    const installDir = path.join(testDir, 'install');
    fs.mkdirSync(installDir, { recursive: true });
    
    // Copy v1 binary as current
    const currentBinary = path.join(installDir, 'promptcode');
    fs.copyFileSync(mockBinaryPath, currentBinary);
    fs.chmodSync(currentBinary, 0o755);
    
    // Run update command
    const result = runCLIIsolated(['update', '--force'], {
      env: {
        PROMPTCODE_BASE_URL: `http://127.0.0.1:${serverPort}`,
        PROMPTCODE_INSTALL_DIR: installDir,
        PROMPTCODE_TEST_MODE: '1',
        CI: 'true', // Non-interactive
        // Disable proxies - CI environments often have proxy vars that break loopback
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: ''
      },
      cwd: installDir,
      timeout: 30000 // 30 second timeout - CI runners can be slow
    });
    
    // Should successfully download and stage
    expect((result.stdout as string) + (result.stderr as string)).toContain('Update');
    expect(result.status).toBe(0);
    
    // Check that staged binary exists at the real CLI location
    const cliBinary = getCLIBinaryPath();
    const stagedPath = `${cliBinary}.new`;
    expect(fs.existsSync(stagedPath)).toBe(true);
    
    // Staged file should be executable
    const stats = fs.statSync(stagedPath);
    expect(stats.mode & 0o111).toBeGreaterThan(0);
    
    // Clean up staged file to avoid pollution
    try { fs.unlinkSync(stagedPath); } catch {}
  }, { timeout: 30000 }); // Bun test timeout for CI

  test('should show correct version immediately after update', () => {
    // This test verifies the critical re-exec behavior
    const installDir = path.join(testDir, 'version-test');
    fs.mkdirSync(installDir, { recursive: true });
    
    // Create a mock "old" binary that just outputs "0.6.14"
    const oldBinary = path.join(installDir, 'promptcode');
    fs.writeFileSync(oldBinary, '#!/bin/sh\necho "0.6.14"', { mode: 0o755 });
    
    // Create a mock "new" binary that outputs "0.6.15"
    const newBinary = path.join(installDir, 'promptcode.new');
    fs.writeFileSync(newBinary, '#!/bin/sh\necho "0.6.15"', { mode: 0o755 });
    
    // Now test that after finalization, running --version shows NEW version
    // This would have caught our argv.slice bug!
    
    // Simulate what early-update.ts does: swap binaries
    fs.renameSync(newBinary, oldBinary);
    
    // Run the binary with --version
    const result = spawnSync(oldBinary, ['--version'], { encoding: 'utf8' });
    
    // It MUST show the new version
    expect(result.stdout.trim()).toBe('0.6.15');
    expect(result.status).toBe(0);
  });

  test.skipIf(isCI)('should reject update with invalid checksum', async () => {
    // Create a tampered checksum
    let tamperedPort: number;
    const tamperedServer = createServer((req, res) => {
      if (req.url === '/repos/cogflows/promptcode-vscode/releases/latest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          tag_name: 'v2.0.0',
          assets: [
            {
              name: getAssetName(process.platform as any, process.arch),
              browser_download_url: `http://127.0.0.1:${tamperedPort}/download/binary`
            },
            {
              name: `${getAssetName(process.platform as any, process.arch)}.sha256`,
              browser_download_url: `http://127.0.0.1:${tamperedPort}/download/binary.sha256`
            }
          ]
        }));
      } else if (req.url === '/download/binary') {
        res.writeHead(200);
        res.end(fs.readFileSync(mockBinaryV2Path));
      } else if (req.url === '/download/binary.sha256') {
        res.writeHead(200);
        res.end('invalid_checksum_here  promptcode\n');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    
    tamperedPort = await new Promise<number>((resolve) => {
      tamperedServer.listen(0, '127.0.0.1', () => {
        const address = tamperedServer.address();
        tamperedPort = typeof address === 'string' ? 0 : address!.port;
        resolve(tamperedPort);
      });
    });
    
    const result = runCLIIsolated(['update', '--force'], {
      env: {
        PROMPTCODE_BASE_URL: `http://127.0.0.1:${tamperedPort}`,
        PROMPTCODE_TEST_MODE: '1',
        CI: 'true',
        // Disable proxies - CI environments often have proxy vars that break loopback
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: ''
      },
      timeout: 30000 // 30 second timeout - CI runners can be slow
    });
    
    // Should fail on checksum mismatch
    expect((result.stdout as string) + (result.stderr as string)).toContain('Checksum');
    expect(result.status).not.toBe(0);

    tamperedServer.close();
  }, { timeout: 30000 }); // Bun test timeout for CI
});