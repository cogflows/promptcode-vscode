import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { scanFiles } from '@promptcode/core';

suite('File scanning + ignore semantics', () => {
  test('respects .gitignore and .promptcode_ignore', async () => {
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

    // The files already have relative paths in the 'path' property
    const rels = files.map(f => f.path).sort();
    assert.ok(rels.includes('src/a.ts'), 'src/a.ts should be selected');
    assert.ok(!rels.includes('src/b.ts'), 'src/b.ts should be ignored by .promptcode_ignore');
  });
});