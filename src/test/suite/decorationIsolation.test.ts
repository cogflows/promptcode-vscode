/* PromptCode - MIT License - Copyright (c) 2025 cogflows */
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { FileExplorerProvider, checkedItems } from '../../fileExplorer';

suite('Decoration Isolation Test', () => {
    let fileExplorer: FileExplorerProvider;
    let tempDir: string;

    suiteSetup(async () => {
        // Create a temporary directory for test files
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'promptcode-isolation-'));
        
        // Create test files
        const testFile = path.join(tempDir, 'test.txt');
        await fs.promises.writeFile(testFile, 'test content');
        
        // Initialize the file explorer
        fileExplorer = new FileExplorerProvider(vscode.workspace.workspaceFolders || []);
        fileExplorer.initializeWorkspaceRoots();
        
        // Select the test file to ensure decoration cache has data
        checkedItems.set(testFile, vscode.TreeItemCheckboxState.Checked);
        (fileExplorer as any).updateDecorationCache();
    });

    suiteTeardown(async () => {
        // Clean up
        checkedItems.clear();
        if (tempDir && fs.existsSync(tempDir)) {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
    });

    test('Decorations should ONLY appear for URIs with our query flag', () => {
        const testPath = path.join(tempDir, 'test.txt');
        
        // Our tree's URI (with query flag pc=1)
        const ourUri = vscode.Uri.file(testPath).with({ query: 'pc=1' });
        
        // Native Explorer's URI (plain file://)
        const explorerUri = vscode.Uri.file(testPath);
        
        // Test: Our tree should be decorated
        const ourDecoration = fileExplorer.provideFileDecoration(ourUri);
        assert.ok(ourDecoration, 'Our tree URI (with pc=1 query) should be decorated');
        assert.strictEqual(ourDecoration.badge, '●', 'Should show full circle for selected file');
        
        // Test: Native Explorer should NOT be decorated
        const explorerDecoration = fileExplorer.provideFileDecoration(explorerUri);
        assert.strictEqual(explorerDecoration, undefined, 'Explorer URI (without query) should NOT be decorated');
    });

    test('Decorations should reject non-file schemes even with query', () => {
        const testPath = path.join(tempDir, 'test.txt');
        
        // Custom scheme with our query flag - should still be rejected
        const customSchemeUri = vscode.Uri.file(testPath).with({ 
            scheme: 'custom', 
            query: 'pc=1' 
        });
        
        const decoration = fileExplorer.provideFileDecoration(customSchemeUri);
        assert.strictEqual(decoration, undefined, 'Non-file scheme should not be decorated even with query');
    });

    test('Directory decorations should also respect query flag', () => {
        // Select another file to make directory partially selected
        const anotherFile = path.join(tempDir, 'another.txt');
        fs.writeFileSync(anotherFile, 'content');
        
        // Don't select it, so directory is partially selected
        (fileExplorer as any).updateDecorationCache();
        
        // Our tree's directory URI
        const ourDirUri = vscode.Uri.file(tempDir).with({ query: 'pc=1' });
        
        // Explorer's directory URI
        const explorerDirUri = vscode.Uri.file(tempDir);
        
        // Our tree should show decoration
        const ourDecoration = fileExplorer.provideFileDecoration(ourDirUri);
        assert.ok(ourDecoration, 'Our tree directory should be decorated');
        
        // Explorer should not
        const explorerDecoration = fileExplorer.provideFileDecoration(explorerDirUri);
        assert.strictEqual(explorerDecoration, undefined, 'Explorer directory should NOT be decorated');
        
        // Clean up
        fs.unlinkSync(anotherFile);
    });
});