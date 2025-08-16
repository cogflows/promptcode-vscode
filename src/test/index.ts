import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';
import * as fs from 'fs';

// Export the run function that VS Code test infrastructure expects
export async function run(): Promise<void> {
  console.log('[TEST] Test index.ts loaded - run() function is being called');
  
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000 // 10 second timeout
  });

  const testsRoot = path.resolve(__dirname, '.');
  console.log('[TEST] Test root:', testsRoot);
  console.log('[TEST] Current working directory:', process.cwd());

  try {
    console.log('[TEST] Starting glob search for test files...');
    // glob@11+ uses promise API, not callbacks
    const files = await glob('**/*.test.js', { cwd: testsRoot });
    console.log('[TEST] Found test files:', files);
    
    if (files.length === 0) {
      console.error('[TEST] No test files found!');
      console.error('[TEST] Looking in:', testsRoot);
      // List what's actually in the directory
      console.log('[TEST] Directory contents:', fs.readdirSync(testsRoot));
    }
    
    // Add files to the test suite
    files.forEach(f => {
      const fullPath = path.resolve(testsRoot, f);
      console.log('[TEST] Adding test file:', fullPath);
      mocha.addFile(fullPath);
    });

    // Promisify mocha.run
    console.log('[TEST] Starting Mocha run...');
    const failures = await new Promise<number>(resolve => mocha.run(resolve));
    console.log('[TEST] Mocha run completed with', failures, 'failures');
    
    if (failures > 0) {
      throw new Error(`${failures} tests failed.`);
    }
  } catch (err) {
    console.error('[TEST] Error finding or running tests:', err);
    throw err;
  }
}

// Log when this module is loaded
console.log('[TEST] Test index.ts module loaded');
console.log('[TEST] __dirname:', __dirname);
console.log('[TEST] run function exported:', typeof run);