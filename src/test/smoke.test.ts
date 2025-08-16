import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

suite('Extension Smoke Test', () => {
    vscode.window.showInformationMessage('Start smoke tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('cogflows.promptcode'));
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('cogflows.promptcode');
        assert.ok(ext);
        await ext!.activate();
        assert.ok(ext!.isActive);
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        
        // Check that main commands are registered
        assert.ok(commands.includes('promptcode.showPromptCodeView'));
        assert.ok(commands.includes('promptcode.generatePrompt'));
        assert.ok(commands.includes('promptcode.selectAll'));
        assert.ok(commands.includes('promptcode.deselectAll'));
        assert.ok(commands.includes('promptcode.clearTokenCache'));
    });

    test('All contributed commands from package.json are registered', async () => {
        // This test ensures all commands in package.json are actually registered
        const packageJsonPath = path.join(__dirname, '../../package.json');
        const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        const contributed = (pkg.contributes?.commands ?? []).map((c: any) => c.command);
        const registered = await vscode.commands.getCommands(true);
        
        for (const cmd of contributed) {
            assert.ok(registered.includes(cmd), `Missing command: ${cmd}`);
        }
    });

    test('Core integration should work', async () => {
        // This test verifies that the core package is properly integrated
        const ext = vscode.extensions.getExtension('cogflows.promptcode');
        await ext!.activate();
        
        // Try to get selected files (should return empty array initially)
        const result = await vscode.commands.executeCommand('promptcode.getSelectedFiles');
        assert.ok(Array.isArray(result));
    });

    test('Should handle deactivation gracefully', () => {
        // This test ensures the extension can deactivate without errors
        const ext = vscode.extensions.getExtension('cogflows.promptcode');
        if (ext && ext.exports && ext.exports.deactivate) {
            assert.doesNotThrow(() => {
                ext.exports.deactivate();
            });
        }
    });

    suiteTeardown(async () => {
        // Ensure extension is properly deactivated to prevent hanging
        // This disposes of any watchers/timers that might keep the process alive
        const ext = vscode.extensions.getExtension('cogflows.promptcode');
        if (ext?.isActive && ext.exports?.deactivate) {
            try {
                await ext.exports.deactivate();
            } catch (e) {
                // Don't fail the build on deactivation errors
                console.warn('Extension deactivate threw:', e);
            }
        }
    });
});