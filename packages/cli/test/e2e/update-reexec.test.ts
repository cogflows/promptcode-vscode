import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createTempDir, cleanupTempDir } from '../helpers/cli-runner';

describe('E2E: Update Re-exec Argument Forwarding', () => {
  let testDir: string;
  
  beforeEach(() => {
    testDir = createTempDir('reexec-test-');
  });
  
  afterEach(() => {
    cleanupTempDir(testDir);
  });

  test('should forward only user arguments after re-exec', () => {
    // This test verifies that only user arguments are passed to the re-executed binary,
    // not the script/binary path itself
    
    const currentBinary = path.join(testDir, 'promptcode');
    const stagedBinary = `${currentBinary}.new`;
    const argRecordFile = path.join(testDir, 'recorded-args.json');
    
    // Create current binary that simulates the re-exec logic
    const currentScript = `#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const realBin = process.argv[1];
const staged = realBin + '.new';

// Simulate finalization and re-exec
if (fs.existsSync(staged) && !process.env.PROMPTCODE_REEXEC_DEPTH) {
  // Swap binaries
  fs.renameSync(staged, realBin);
  
  // Re-exec with computed user args (testing the heuristic)
  const argv = process.argv;
  const maybeScript = argv[1] || '';
  const looksLikePath = maybeScript === realBin
    || path.resolve(maybeScript) === realBin
    || maybeScript.includes('/')
    || /\\.m?js$/.test(maybeScript)
    || path.basename(maybeScript).startsWith('promptcode');
  
  const userArgs = looksLikePath ? argv.slice(2) : argv.slice(1);
  
  const env = { ...process.env, PROMPTCODE_REEXEC_DEPTH: '1' };
  const res = spawnSync(realBin, userArgs, { stdio: 'inherit', env });
  process.exit(res.status || 0);
}

// If we're the re-executed binary, record what args we received
if (process.env.PROMPTCODE_REEXEC_DEPTH === '1') {
  const recordedArgs = process.argv.slice(2);
  fs.writeFileSync('${argRecordFile}', JSON.stringify(recordedArgs, null, 2));
  console.log('Args recorded');
  process.exit(0);
}
`;

    // Create staged binary that records its arguments
    const stagedScript = `#!/usr/bin/env node
const fs = require('fs');

// For preflight check
if (process.argv[2] === '--version' && process.env.PROMPTCODE_SKIP_FINALIZE === '1') {
  console.log('0.6.15');
  process.exit(0);
}

// Record args when executed after swap
const recordedArgs = process.argv.slice(2);
fs.writeFileSync('${argRecordFile}', JSON.stringify(recordedArgs, null, 2));
console.log('Args recorded');
process.exit(0);
`;

    fs.writeFileSync(currentBinary, currentScript, { mode: 0o755 });
    fs.writeFileSync(stagedBinary, stagedScript, { mode: 0o755 });
    
    // Test various argument patterns
    const testCases = [
      { args: ['--version'], expected: ['--version'] },
      { args: ['generate', '-f', 'src/**/*.ts'], expected: ['generate', '-f', 'src/**/*.ts'] },
      { args: ['expert', 'Why is this slow?', '--preset', 'api'], expected: ['expert', 'Why is this slow?', '--preset', 'api'] },
      { args: [], expected: [] },
      { args: ['--help'], expected: ['--help'] },
    ];
    
    for (const testCase of testCases) {
      // Clean up any previous arg record and reset binaries
      try { fs.unlinkSync(argRecordFile); } catch {}
      
      // Recreate current binary and staged binary for each test
      fs.writeFileSync(currentBinary, currentScript, { mode: 0o755 });
      fs.writeFileSync(stagedBinary, stagedScript, { mode: 0o755 });
      
      // Run the binary with test arguments
      const result = spawnSync(currentBinary, testCase.args, {
        encoding: 'utf8',
        cwd: testDir,
        env: { ...process.env, PATH: testDir + ':' + process.env.PATH }
      });
      
      // Check that args were recorded correctly
      expect(fs.existsSync(argRecordFile)).toBe(true);
      const recordedArgs = JSON.parse(fs.readFileSync(argRecordFile, 'utf8'));
      expect(recordedArgs).toEqual(testCase.expected);
      
      // Staged binary should have been swapped (renamed to current)
      expect(fs.existsSync(stagedBinary)).toBe(false);
    }
  });

  test('should handle different runtime argv shapes', () => {
    // Test the heuristic with different argv patterns that various runtimes might produce
    
    const testBinary = path.join(testDir, 'test-argv');
    const argRecordFile = path.join(testDir, 'argv-test.json');
    
    // Create a test script that exercises the argv heuristic
    const testScript = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// This simulates the heuristic from early-update.ts
function computeUserArgs(realBin, argv) {
  const maybeScript = argv[1] || '';
  const looksLikePath = maybeScript === realBin
    || path.resolve(maybeScript) === realBin
    || maybeScript.includes('/')
    || /\\.m?js$/.test(maybeScript)
    || path.basename(maybeScript).startsWith('promptcode');
  
  return looksLikePath ? argv.slice(2) : argv.slice(1);
}

// Test different argv shapes
const testCases = [
  // Node script execution
  { 
    argv: ['node', '/path/to/promptcode', '--version'],
    realBin: '/path/to/promptcode',
    expected: ['--version']
  },
  // Bun script execution
  {
    argv: ['bun', '/path/to/promptcode.js', 'generate', '-f', 'x'],
    realBin: '/path/to/promptcode',
    expected: ['generate', '-f', 'x']
  },
  // Compiled binary (no script path)
  {
    argv: ['/usr/local/bin/promptcode', '--version'],
    realBin: '/usr/local/bin/promptcode',
    expected: ['--version']
  },
  // Wrapper that duplicates binary path
  {
    argv: ['/usr/local/bin/promptcode', '/usr/local/bin/promptcode', '--version'],
    realBin: '/usr/local/bin/promptcode',
    expected: ['--version']
  },
  // Regular command
  {
    argv: ['/usr/local/bin/promptcode', 'preset', 'list'],
    realBin: '/usr/local/bin/promptcode',
    expected: ['preset', 'list']
  }
];

const results = testCases.map(tc => ({
  input: tc.argv,
  realBin: tc.realBin,
  expected: tc.expected,
  actual: computeUserArgs(tc.realBin, tc.argv),
  passed: JSON.stringify(computeUserArgs(tc.realBin, tc.argv)) === JSON.stringify(tc.expected)
}));

fs.writeFileSync('${argRecordFile}', JSON.stringify(results, null, 2));

const allPassed = results.every(r => r.passed);
process.exit(allPassed ? 0 : 1);
`;

    fs.writeFileSync(testBinary, testScript, { mode: 0o755 });
    
    // Run the test
    const result = spawnSync(testBinary, [], {
      encoding: 'utf8',
      cwd: testDir
    });
    
    // Check results
    expect(result.status).toBe(0);
    const results = JSON.parse(fs.readFileSync(argRecordFile, 'utf8'));
    
    for (const r of results) {
      expect(r.passed).toBe(true);
      expect(r.actual).toEqual(r.expected);
    }
  });

  test('should preserve stdout cleanliness for --version after update', () => {
    // Ensure update message goes to stderr, version to stdout
    
    const currentBinary = path.join(testDir, 'promptcode');
    const stagedBinary = `${currentBinary}.new`;
    
    // Simple re-exec simulator
    const currentScript = `#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');

const realBin = process.argv[1];
const staged = realBin + '.new';

if (fs.existsSync(staged) && !process.env.PROMPTCODE_REEXEC_DEPTH) {
  fs.renameSync(staged, realBin);
  
  // Update message to stderr
  console.error('[promptcode] Applied pending update to v0.6.15; restarting...');
  
  const userArgs = process.argv.slice(2);
  const env = { ...process.env, PROMPTCODE_REEXEC_DEPTH: '1' };
  const res = spawnSync(realBin, userArgs, { stdio: 'inherit', env });
  process.exit(res.status || 0);
}

// Re-executed binary outputs version to stdout
if (process.argv[2] === '--version') {
  console.log('0.6.15');
} else {
  console.log('Unknown command');
}
`;

    fs.writeFileSync(currentBinary, currentScript, { mode: 0o755 });
    fs.writeFileSync(stagedBinary, currentScript, { mode: 0o755 });
    
    // Run with --version
    const result = spawnSync(currentBinary, ['--version'], {
      encoding: 'utf8',
      cwd: testDir
    });
    
    // stdout should contain ONLY the version
    expect(result.stdout.trim()).toBe('0.6.15');
    
    // stderr should contain the update message
    expect(result.stderr).toContain('Applied pending update');
    
    // Should exit successfully
    expect(result.status).toBe(0);
  });
});