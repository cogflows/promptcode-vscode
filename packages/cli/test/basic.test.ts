import { describe, it, expect } from 'bun:test';
import { spawn } from 'child_process';
import * as path from 'path';

describe('basic CLI functionality', () => {
  it('should show version', async () => {
    const cliPath = path.join(__dirname, '..', 'dist', 'promptcode');
    
    const result = await new Promise<{ stdout: string; exitCode: number }>((resolve) => {
      const child = spawn(cliPath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.on('close', (code) => {
        resolve({ stdout, exitCode: code || 0 });
      });
    });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/); // version pattern
  });
  
  it('should show help', async () => {
    const cliPath = path.join(__dirname, '..', 'dist', 'promptcode');
    
    const result = await new Promise<{ stdout: string; exitCode: number }>((resolve) => {
      const child = spawn(cliPath, ['--help'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.on('close', (code) => {
        resolve({ stdout, exitCode: code || 0 });
      });
    });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Generate AI-ready prompts');
  });
});