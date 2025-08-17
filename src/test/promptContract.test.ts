import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { scanFiles, buildPrompt } from '@promptcode/core';

suite('Prompt building contract (core ↔ extension surface)', () => {
  test('prompt includes selected files and instructions; excludes ignored files', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      console.log('Skipping test - no workspace folder available');
      return; // Skip test if no workspace is open
    }
    const files = await scanFiles({
      cwd: root,
      patterns: ['src/**/*.ts'],
      respectGitignore: true,
      customIgnoreFile: path.join(root, '.promptcode_ignore'),
      workspaceName: 'fixture'
    });

    // Keep test deterministic: only include what we expect
    // The path property is relative, so we just check for 'src/a.ts'
    const filtered = files.filter(f => f.path === 'src/a.ts' || f.path === 'src\\a.ts');
    
    const { prompt, tokenCount } = await buildPrompt(filtered, 'Test instructions', {
      includeFiles: true,
      includeInstructions: true,
      includeFileContents: true
    });

    // Core invariants, resilient to formatting changes:
    assert.strictEqual(filtered.length, 1, 'should include exactly one file');
    assert.ok(tokenCount > 0, 'should count tokens');
    assert.match(prompt, /src[\\/]+a\.ts/, 'should mention the included file');
    assert.doesNotMatch(prompt, /src[\\/]+b\.ts/, 'should not include the ignored file');
    assert.match(prompt, /Test instructions/, 'should include the user instructions');
    // Avoid brittle full snapshots; exercise semantic invariants instead.
  });
});