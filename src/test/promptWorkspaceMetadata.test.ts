import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { generatePrompt } from '../promptGenerator';
import type { SelectedFile } from '@promptcode/core';

suite('Prompt workspace metadata', () => {
  test('generatePrompt includes workspace name and root for each file', async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      console.log('Skipping test - no workspace folder available');
      return;
    }

    const workspaceRoot = workspace.uri.fsPath;
    const workspaceName = workspace.name;
    const absolutePath = path.join(workspaceRoot, 'src', 'a.ts');

    const selectedFiles: SelectedFile[] = [
      {
        path: 'src/a.ts',
        absolutePath,
        tokenCount: 1, // Value is informational only for this assertion
        workspaceFolderRootPath: workspaceRoot,
        workspaceFolderName: workspaceName
      }
    ];

    const prompt = await generatePrompt(selectedFiles, 'Test instructions', {
      files: true,
      instructions: true
    });

    const escapedRoot = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const workspaceLine = new RegExp(`Workspace:\\s*${workspaceName}\\s*\\(${escapedRoot}\\)`);

    assert.match(prompt, workspaceLine, 'prompt should include workspace name and root');
    assert.match(prompt, /File:\s*src\/a\.ts/i, 'prompt should include the relative file path');
  });
});
