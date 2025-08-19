import * as assert from 'assert';
import * as vscode from 'vscode';

suite('PromptCode extension – activation & commands', () => {
  test('activates and registers core commands', async () => {
    const ext = vscode.extensions.getExtension('cogflows.promptcode');
    assert.ok(ext, 'Extension not found by ID (publisher.name in package.json)');
    await ext!.activate();

    const cmds = await vscode.commands.getCommands(true);
    const expected = [
      'promptcode.showFileSelector',
      'promptcode.generatePrompt',
      'promptcode.selectAll',
      'promptcode.deselectAll',
      'promptcode.copyToClipboard',
      'promptcode.showPromptCodeView',
      'promptcode.clearTokenCache',
      'promptcode.refreshFileExplorer',
      'promptcode.copyFilePath',
      'promptcode.copyRelativeFilePath',
      'promptcode.openFileInEditor'
    ];

    for (const c of expected) {
      assert.ok(cmds.includes(c), `Missing command: ${c}`);
    }
  });
});