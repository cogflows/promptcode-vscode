import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { createTestFixture } from '../test-utils';
import { generateApprovalHook } from '../../src/hooks/generate-approval-hook';

describe('approval hook', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  let hookPath: string;
  
  beforeEach(async () => {
    fixture = createTestFixture('hook-test');
    hookPath = path.join(fixture.dir, 'test-hook.sh');
    
    // Generate and write the hook
    const hookContent = generateApprovalHook();
    await fs.promises.writeFile(hookPath, hookContent);
    await fs.promises.chmod(hookPath, '755');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });
  
  /**
   * Run the hook with given input
   */
  async function runHook(command: string): Promise<{ exitCode: number; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(hookPath, [], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stderr = '';
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      // Send JSON input
      const input = JSON.stringify({
        tool_input: { command }
      });
      child.stdin.write(input);
      child.stdin.end();
      
      child.on('close', (code) => {
        resolve({
          exitCode: code || 0,
          stderr
        });
      });
    });
  }
  
  it('should allow non-expert commands', async () => {
    const result = await runHook('promptcode generate -f "*.ts"');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
  
  it('should allow expert commands with --yes', async () => {
    const result = await runHook('promptcode expert "Test question" --model o3-pro --yes');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
  
  it('should allow expert commands with --no-confirm', async () => {
    const result = await runHook('promptcode expert "Test question" --model o3-pro --no-confirm');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
  
  it('should allow expert commands with -y', async () => {
    const result = await runHook('promptcode expert "Test question" --model o3-pro -y');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
  
  it('should block expensive models without approval', async () => {
    const result = await runHook('promptcode expert "Test question" --model o3-pro');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Expensive AI model detected');
    expect(result.stderr).toContain('o3-pro');
    expect(result.stderr).toContain('--yes flag');
  });
  
  it('should handle --model=name syntax', async () => {
    const result = await runHook('promptcode expert "Test question" --model=o3-pro');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Expensive AI model detected');
  });
  
  it('should handle case-insensitive model names', async () => {
    const result = await runHook('promptcode expert "Test question" --model O3-PRO');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Expensive AI model detected');
  });
  
  it('should detect opus-4 model', async () => {
    const result = await runHook('promptcode expert "Test question" --model opus-4');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Expensive AI model detected');
  });
  
  it('should detect gpt-4-pro model', async () => {
    const result = await runHook('promptcode expert "Test question" --model gpt-4-pro');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Expensive AI model detected');
  });
  
  it('should warn about large file selections', async () => {
    const result = await runHook('promptcode expert "Test question" -f "**/*.ts"');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Large file selection detected');
    expect(result.stderr).toContain('$0.50');
  });
  
  it('should warn about wildcard patterns', async () => {
    const result = await runHook('promptcode expert "Test question" -f "src/**/*"');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Large file selection detected');
  });
  
  it('should allow cheap models with small file sets', async () => {
    const result = await runHook('promptcode expert "Test question" --model o3 -f "single-file.ts"');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
  
  it('should handle edge cases gracefully', async () => {
    // Empty command
    let result = await runHook('');
    expect(result.exitCode).toBe(0);
    
    // No model specified
    result = await runHook('promptcode expert "Test question"');
    expect(result.exitCode).toBe(0); // Should pass, assumes default model
    
    // Multiple spaces
    result = await runHook('promptcode   expert   "Test"  --model   o3-pro');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Expensive AI model detected');
  });
});