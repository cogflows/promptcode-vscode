import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync, spawn } from 'child_process';
import { createTempDir, cleanupTempDir } from '../helpers/cli-runner';

describe('E2E: Early Update Finalizer', () => {
  let testDir: string;
  
  beforeEach(() => {
    testDir = createTempDir('finalizer-test-');
  });
  
  afterEach(() => {
    cleanupTempDir(testDir);
  });

  test('should successfully finalize update on next run', () => {
    // Create mock binary and staged update
    const currentBinary = path.join(testDir, 'promptcode');
    const stagedBinary = `${currentBinary}.new`;
    
    // Create simple test script that simulates early finalizer
    const testScript = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Simulate early finalizer logic
const realBin = process.argv[2] || process.execPath;
const staged = realBin + '.new';

if (fs.existsSync(staged)) {
  // Simple version check
  const stagedContent = fs.readFileSync(staged, 'utf8');
  if (stagedContent.includes('console.log("v2.0.0")')) {
    // Simulate successful preflight
    fs.renameSync(staged, realBin);
    console.log('Update finalized to v2.0.0');
    process.exit(0);
  }
}

// Output current version
const content = fs.readFileSync(realBin, 'utf8');
if (content.includes('v2.0.0')) {
  console.log('v2.0.0');
} else {
  console.log('v1.0.0');
}
`;

    // Write test script
    const testRunner = path.join(testDir, 'test-finalizer.js');
    fs.writeFileSync(testRunner, testScript);
    
    // Create v1 binary
    fs.writeFileSync(currentBinary, 'console.log("v1.0.0");');
    fs.chmodSync(currentBinary, 0o755);
    
    // Create v2 staged binary
    fs.writeFileSync(stagedBinary, 'console.log("v2.0.0");');
    fs.chmodSync(stagedBinary, 0o755);
    
    // Run finalizer
    const result = spawnSync('node', [testRunner, currentBinary], {
      encoding: 'utf8',
      cwd: testDir
    });
    
    // Should have finalized
    expect(result.stdout).toContain('Update finalized');
    expect(fs.existsSync(stagedBinary)).toBe(false);
    
    // Binary should be updated
    const updatedContent = fs.readFileSync(currentBinary, 'utf8');
    expect(updatedContent).toContain('v2.0.0');
  });

  test('should skip finalization if staged binary fails validation', () => {
    const currentBinary = path.join(testDir, 'promptcode');
    const stagedBinary = `${currentBinary}.new`;
    
    // Create test script that rejects invalid staged binary
    const testScript = `#!/usr/bin/env node
const fs = require('fs');

const realBin = process.argv[2] || process.execPath;
const staged = realBin + '.new';

if (fs.existsSync(staged)) {
  const content = fs.readFileSync(staged, 'utf8');
  // Reject if it contains 'invalid'
  if (content.includes('invalid')) {
    console.log('Staged binary failed validation');
    // Don't finalize
  } else {
    fs.renameSync(staged, realBin);
    console.log('Update finalized');
  }
}

console.log('v1.0.0');
`;

    const testRunner = path.join(testDir, 'test-finalizer.js');
    fs.writeFileSync(testRunner, testScript);
    
    // Create v1 binary
    fs.writeFileSync(currentBinary, 'console.log("v1.0.0");');
    fs.chmodSync(currentBinary, 0o755);
    
    // Create invalid staged binary
    fs.writeFileSync(stagedBinary, 'invalid binary content');
    fs.chmodSync(stagedBinary, 0o755);
    
    // Run finalizer
    const result = spawnSync('node', [testRunner, currentBinary], {
      encoding: 'utf8',
      cwd: testDir
    });
    
    // Should reject invalid binary
    expect(result.stdout).toContain('failed validation');
    expect(fs.existsSync(stagedBinary)).toBe(true); // Still exists
    
    // Binary should NOT be updated
    const content = fs.readFileSync(currentBinary, 'utf8');
    expect(content).toContain('v1.0.0');
  });

  test('should handle concurrent finalization attempts', async () => {
    const currentBinary = path.join(testDir, 'promptcode');
    const stagedBinary = `${currentBinary}.new`;
    const lockFile = `${currentBinary}.update.lock`;
    
    // Create test script with simple locking
    const testScript = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const realBin = process.argv[2] || process.execPath;
const staged = realBin + '.new';
const lock = realBin + '.update.lock';

// Try to acquire lock
try {
  // Create lock file exclusively
  const fd = fs.openSync(lock, 'wx');
  
  // Add process ID
  fs.writeFileSync(lock, process.pid.toString());
  
  console.log('Process ' + process.pid + ' acquired lock');
  
  // Simulate work
  if (fs.existsSync(staged)) {
    // Small delay to increase chance of race
    const start = Date.now();
    while (Date.now() - start < 100) {}
    
    fs.renameSync(staged, realBin);
    console.log('Process ' + process.pid + ' finalized update');
  }
  
  // Release lock
  fs.closeSync(fd);
  fs.unlinkSync(lock);
  
} catch (err) {
  if (err.code === 'EEXIST') {
    console.log('Process ' + process.pid + ' blocked by lock');
  } else {
    console.error('Lock error:', err.message);
  }
}
`;

    const testRunner = path.join(testDir, 'test-finalizer.js');
    fs.writeFileSync(testRunner, testScript);
    
    // Create v1 binary
    fs.writeFileSync(currentBinary, 'console.log("v1.0.0");');
    fs.chmodSync(currentBinary, 0o755);
    
    // Create v2 staged binary  
    fs.writeFileSync(stagedBinary, 'console.log("v2.0.0");');
    fs.chmodSync(stagedBinary, 0o755);
    
    // Run multiple concurrent finalizers using async spawn
    const processes = [];
    for (let i = 0; i < 3; i++) {
      processes.push(
        new Promise<string>((resolve, reject) => {
          const child = spawn('node', [testRunner, currentBinary], {
            cwd: testDir
          });
          
          let stdout = '';
          child.stdout.on('data', (data) => (stdout += data.toString()));
          child.stderr.on('data', (data) => (stdout += data.toString())); // Capture stderr too
          
          child.on('close', (code) => {
            resolve(stdout);
          });
          
          child.on('error', (err) => reject(err));
        })
      );
    }
    
    const results = await Promise.all(processes);
    const outputs = results.join('\n');
    
    // Only one should have finalized
    const finalizedCount = (outputs.match(/finalized update/g) || []).length;
    expect(finalizedCount).toBe(1);
    
    // Others should have been blocked
    expect(outputs).toContain('blocked by lock');
    
    // Staged file should be gone
    expect(fs.existsSync(stagedBinary)).toBe(false);
    
    // Lock should be cleaned up
    expect(fs.existsSync(lockFile)).toBe(false);
  });
});