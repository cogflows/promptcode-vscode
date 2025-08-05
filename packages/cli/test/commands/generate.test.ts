import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { createTestFixture, createTestFiles, runCLI, assertFileExists } from '../test-utils';

describe('generate command', () => {
  let fixture: ReturnType<typeof createTestFixture>;
  
  beforeEach(() => {
    fixture = createTestFixture('generate-test');
  });
  
  afterEach(() => {
    fixture.cleanup();
  });
  
  it('should generate prompt from all files', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Hello World");',
      'src/utils.ts': 'export function add(a: number, b: number) { return a + b; }',
      'README.md': '# Test Project'
    });
    
    const result = await runCLI(['generate'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello World');
    expect(result.stdout).toContain('add(a: number, b: number)');
    expect(result.stdout).toContain('Test Project');
  });
  
  it('should generate prompt with specific file patterns', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("TypeScript");',
      'src/index.js': 'console.log("JavaScript");',
      'docs/readme.md': '# Documentation'
    });
    
    const result = await runCLI(['generate', '-f', 'src/**/*.ts'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('TypeScript');
    expect(result.stdout).not.toContain('JavaScript');
    expect(result.stdout).not.toContain('Documentation');
  });
  
  it('should save output to file with --output', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    const outputPath = path.join(fixture.dir, 'output.md');
    const result = await runCLI(['generate', '--output', outputPath], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    assertFileExists(outputPath, 'console.log("Test")');
  });
  
  it('should load patterns from preset', async () => {
    createTestFiles(fixture.dir, {
      '.promptcode/presets/backend.patterns': '# Backend files\nsrc/**/*.ts\n!**/*.test.ts',
      'src/server.ts': 'const server = express();',
      'src/server.test.ts': 'describe("server", () => {});',
      'frontend/app.js': 'const app = {};'
    });
    
    const result = await runCLI(['generate', '--preset', 'backend'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('const server = express()');
    expect(result.stdout).not.toContain('describe("server"');
    expect(result.stdout).not.toContain('const app = {}');
  });
  
  it('should handle dry run', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");',
      'src/utils.ts': 'export const util = 1;'
    });
    
    const result = await runCLI(['generate', '--dry-run'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Dry run - files that would be included');
    expect(result.stdout).toContain('Files: 2');
    expect(result.stdout).not.toContain('console.log("Test")'); // Should not include actual content
  });
  
  it('should output JSON with metadata', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    const result = await runCLI(['generate', '--json'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json).toHaveProperty('prompt');
    expect(json).toHaveProperty('tokenCount');
    expect(json).toHaveProperty('estimatedCosts');
    expect(json).toHaveProperty('files');
  });
  
  it('should warn for large token counts', async () => {
    // Create many files to exceed token warning
    const files: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      files[`src/file${i}.ts`] = `// ${'A'.repeat(1000)}\nexport const value${i} = ${i};`;
    }
    createTestFiles(fixture.dir, files);
    
    // Use --yes to skip interactive prompt
    const result = await runCLI(['generate', '--token-warning', '1000', '--yes'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Large prompt detected');
  });
  
  it('should save preset from file patterns', async () => {
    createTestFiles(fixture.dir, {
      'src/index.ts': 'console.log("Test");'
    });
    
    const result = await runCLI(['generate', '-f', 'src/**/*.ts', '--save-preset', 'my-files'], { cwd: fixture.dir });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Saved file patterns to preset: my-files');
    assertFileExists(path.join(fixture.dir, '.promptcode/presets/my-files.patterns'), 'src/**/*.ts');
  });
});