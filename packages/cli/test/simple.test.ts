import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { createTestFixture, createTestFiles, runCLI } from './test-utils';

describe('simple CLI tests', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  
  beforeEach(() => {
    fixture = createTestFixture('simple-test');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });

  it('should show version', async () => {
    const result = await runCLI(['--version'], { 
      cwd: fixture.dir,
      timeout: 2000 
    });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should generate prompt with specific file', async () => {
    createTestFiles(fixture.dir, {
      'test.js': 'console.log("hello");'
    });
    
    const result = await runCLI(['generate', '-f', 'test.js'], { 
      cwd: fixture.dir,
      timeout: 3000,
      env: {
        ...process.env,
        PROMPTCODE_TEST: '1',
        PROMPTCODE_TOKEN_WARNING: '999999',
        DEBUG: ''  // Ensure debug is off
      }
    });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('console.log("hello")');
  });

  it('should output clean JSON', async () => {
    createTestFiles(fixture.dir, {
      'test.js': 'const x = 1;'
    });
    
    const result = await runCLI(['generate', '-f', 'test.js', '--json'], { 
      cwd: fixture.dir,
      timeout: 3000,
      env: {
        ...process.env,
        PROMPTCODE_TEST: '1',
        DEBUG: ''  // Critical for clean JSON
      }
    });
    
    expect(result.exitCode).toBe(0);
    
    // JSON should parse without errors
    let json;
    try {
      json = JSON.parse(result.stdout);
    } catch (e) {
      throw new Error(`Invalid JSON output: ${result.stdout}`);
    }
    
    expect(json).toHaveProperty('tokenCount');
    expect(json.files).toBeArray();
    expect(json.files.length).toBe(1);
  });

  it('should exit cleanly in test mode', async () => {
    createTestFiles(fixture.dir, {
      'test.js': 'test'
    });
    
    // This should exit immediately after completion
    const result = await runCLI(['stats'], { 
      cwd: fixture.dir,
      timeout: 2000,  // Short timeout - should complete quickly
      env: {
        ...process.env,
        PROMPTCODE_TEST: '1'
      }
    });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Total files');
  });

  it('should handle errors properly', async () => {
    const result = await runCLI(['generate', '-f', 'does-not-exist.js'], { 
      cwd: fixture.dir,
      timeout: 2000
    });
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No files found');
  });
});