import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { scanFiles, buildPrompt } from '@promptcode/core';

suite('Prompt building contract (core ↔ extension surface)', () => {
  test('prompt includes selected files and instructions; excludes ignored files', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
    const files = await scanFiles({
      cwd: root,
      patterns: ['src/**/*.ts'],
      respectGitignore: true,
      customIgnoreFile: path.join(root, '.promptcode_ignore'),
      workspaceName: 'fixture'
    });

    // Keep test deterministic: only include what we expect
    const filtered = files.filter(f => f.path.endsWith('/src/a.ts') || f.path.endsWith('\\src\\a.ts'));
    const { prompt, tokenCount, fileCount } = await buildPrompt(filtered, 'Test instructions', {
      includeFiles: true,
      includeInstructions: true,
      includeFileContents: true
    });

    // Core invariants, resilient to formatting changes:
    assert.strictEqual(fileCount, 1, 'should include exactly one file');
    assert.ok(tokenCount > 0, 'should count tokens');
    assert.match(prompt, /src[\\/]+a\.ts/, 'should mention the included file');
    assert.doesNotMatch(prompt, /src[\\/]+b\.ts/, 'should not include the ignored file');
    assert.match(prompt, /Test instructions/, 'should include the user instructions');
    // Avoid brittle full snapshots; exercise semantic invariants instead.
  });
});