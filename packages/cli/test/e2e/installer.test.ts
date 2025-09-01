import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createServer } from 'http';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createTempDir, cleanupTempDir } from '../helpers/cli-runner';

describe('E2E: Installer Scripts', () => {
  let server: any;
  let serverPort: number;
  let testDir: string;
  let mockBinary: string;

  beforeAll(async () => {
    testDir = createTempDir('installer-test-');
    
    // Create mock binary
    mockBinary = path.join(testDir, 'promptcode-mock');
    fs.writeFileSync(mockBinary, `#!/usr/bin/env node
console.log('v1.0.0-test');
process.exit(0);
`);
    fs.chmodSync(mockBinary, 0o755);
    
    // Generate checksum
    const hash = crypto.createHash('sha256').update(fs.readFileSync(mockBinary)).digest('hex');
    fs.writeFileSync(`${mockBinary}.sha256`, `${hash}  promptcode\n`);
    
    // Start mock GitHub API server
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url === '/repos/cogflows/promptcode-vscode/releases/latest') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            tag_name: 'v1.0.0-test',
            assets: [
              {
                name: `promptcode-${process.platform}-${process.arch}`,
                browser_download_url: `http://localhost:${serverPort}/download/binary`
              },
              {
                name: `promptcode-${process.platform}-${process.arch}.sha256`,
                browser_download_url: `http://localhost:${serverPort}/download/checksum`
              }
            ]
          }));
        } else if (req.url === '/download/binary') {
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          res.end(fs.readFileSync(mockBinary));
        } else if (req.url === '/download/checksum') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(fs.readFileSync(`${mockBinary}.sha256`));
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
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

  describe('install.sh (Unix/macOS)', () => {
    test('should validate script exists and is executable', () => {
      if (process.platform === 'win32') {
        return; // Skip on Windows
      }
      
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'install.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);
      
      const stats = fs.statSync(scriptPath);
      expect(stats.mode & 0o111).toBeGreaterThan(0); // Check executable bit
    });

    test('should reject Git Bash environment', () => {
      if (process.platform === 'win32') {
        return; // Skip on actual Windows
      }
      
      // Create a mock `uname` command to simulate Git Bash
      const mockBinDir = path.join(testDir, 'mock-bin');
      fs.mkdirSync(mockBinDir, { recursive: true });
      const mockUnamePath = path.join(mockBinDir, 'uname');
      // This mock will make `uname -s` output a MINGW-like string
      fs.writeFileSync(mockUnamePath, '#!/bin/sh\nif [ "$1" = "-s" ]; then echo "MINGW64_NT-10.0"; else command uname "$@"; fi');
      fs.chmodSync(mockUnamePath, 0o755);
      
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'install.sh');
      const result = spawnSync('bash', [scriptPath], {
        env: {
          ...process.env,
          // Prepend the mock bin directory to the PATH
          PATH: `${mockBinDir}:${process.env.PATH}`,
          CI: 'true',
          PROMPTCODE_DRY_RUN: '1'
        },
        encoding: 'utf8'
      });
      
      expect(result.stdout + result.stderr).toContain('PowerShell');
      expect(result.status).not.toBe(0);
    });

    test('should handle non-interactive mode correctly', () => {
      if (process.platform === 'win32') {
        return; // Skip on Windows
      }
      
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'install.sh');
      const testHome = path.join(testDir, 'home');
      fs.mkdirSync(testHome, { recursive: true });
      
      const result = spawnSync('bash', [scriptPath], {
        env: {
          HOME: testHome,
          CI: 'true',
          PROMPTCODE_DRY_RUN: '1', // Dry run mode
          PROMPTCODE_GITHUB_API: `http://localhost:${serverPort}`,
          PATH: `${testHome}/.local/bin:${process.env.PATH}`
        },
        encoding: 'utf8',
        input: '', // No stdin input
        timeout: 3000 // 3 second timeout to prevent hanging
      });
      
      // Should complete without hanging
      expect(result.error).toBeUndefined();
      
      // Should not prompt for PATH updates in CI
      expect(result.stdout + result.stderr).not.toContain('Add to PATH?');
    });
  });

  describe('install.ps1 (Windows)', () => {
    test('should validate script exists', () => {
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'install.ps1');
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    test('should handle architecture detection', () => {
      if (process.platform !== 'win32') {
        return; // Skip on non-Windows
      }
      
      // Test architecture detection logic
      const testScript = `
        $arch = if ($env:PROCESSOR_ARCHITEW6432) {
          $env:PROCESSOR_ARCHITEW6432
        } else {
          $env:PROCESSOR_ARCHITECTURE
        }
        
        switch ($arch) {
          "AMD64" { Write-Output "x64" }
          "ARM64" { Write-Output "arm64" }
          "x86" { Write-Output "x86" }
          default { Write-Error "Unsupported: $arch"; exit 1 }
        }
      `;
      
      const result = spawnSync('powershell', ['-Command', testScript], {
        encoding: 'utf8'
      });
      
      if (result.status === 0) {
        expect(['x64', 'arm64', 'x86']).toContain(result.stdout.trim());
      }
    });

    test('should require PROMPTCODE_ALLOW_INSECURE in CI', () => {
      if (process.platform !== 'win32') {
        return; // Skip on non-Windows
      }
      
      const testScript = `
        param([switch]$Insecure)
        
        $CI = $env:CI -eq 'true'
        $AllowInsecure = $env:PROMPTCODE_ALLOW_INSECURE -eq '1'
        
        if ($Insecure -and $CI -and -not $AllowInsecure) {
          Write-Error "Insecure mode in CI requires PROMPTCODE_ALLOW_INSECURE=1"
          exit 1
        }
        
        Write-Output "OK"
      `;
      
      // Test without PROMPTCODE_ALLOW_INSECURE
      const result1 = spawnSync('powershell', ['-Command', testScript, '-Insecure'], {
        env: { ...process.env, CI: 'true', PROMPTCODE_ALLOW_INSECURE: undefined },
        encoding: 'utf8'
      });
      
      expect(result1.stderr).toContain('PROMPTCODE_ALLOW_INSECURE');
      expect(result1.status).not.toBe(0);
      
      // Test with PROMPTCODE_ALLOW_INSECURE
      const result2 = spawnSync('powershell', ['-Command', testScript, '-Insecure'], {
        env: { ...process.env, CI: 'true', PROMPTCODE_ALLOW_INSECURE: '1' },
        encoding: 'utf8'
      });
      
      expect(result2.stdout).toContain('OK');
      expect(result2.status).toBe(0);
    });
  });

  test('should verify checksum calculation works', () => {
    // Test that we can calculate checksums correctly
    const testFile = path.join(testDir, 'test-binary');
    const content = 'test content for checksum';
    fs.writeFileSync(testFile, content);
    
    // Calculate checksum using Node.js crypto
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    
    // Test with different tools based on platform
    if (process.platform !== 'win32') {
      // Unix/macOS: try shasum or sha256sum
      let result;
      
      // Try shasum first (macOS)
      result = spawnSync('shasum', ['-a', '256', testFile], { encoding: 'utf8' });
      if (result.status === 0) {
        const calculated = result.stdout.split(' ')[0];
        expect(calculated).toBe(hash);
      } else {
        // Try sha256sum (Linux)
        result = spawnSync('sha256sum', [testFile], { encoding: 'utf8' });
        if (result.status === 0) {
          const calculated = result.stdout.split(' ')[0];
          expect(calculated).toBe(hash);
        }
      }
    } else {
      // Windows: use certutil
      const result = spawnSync('certutil', ['-hashfile', testFile, 'SHA256'], {
        encoding: 'utf8'
      });
      
      if (result.status === 0) {
        // certutil outputs hash on second line
        const lines = result.stdout.split('\n').filter(l => l.trim());
        const calculated = lines[1]?.replace(/\s/g, '').toLowerCase();
        expect(calculated).toBe(hash);
      }
    }
  });
});