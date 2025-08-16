import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { scanFiles } from '@promptcode/core';

suite('File scanning + ignore semantics', () => {
  test('respects .gitignore and .promptcode_ignore', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
    const files = await scanFiles({
      cwd: root,
      patterns: ['src/**/*.ts'],
      respectGitignore: true,
      customIgnoreFile: path.join(root, '.promptcode_ignore'),
      workspaceName: 'fixture'
    });

    const rels = files.map(f => path.relative(root, f.path)).sort();
    assert.ok(rels.includes('src/a.ts'), 'src/a.ts should be selected');
    assert.ok(!rels.includes('src/b.ts'), 'src/b.ts should be ignored by .promptcode_ignore');
  });
});