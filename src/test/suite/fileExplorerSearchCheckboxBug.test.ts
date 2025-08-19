import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileExplorerProvider, FileItem, checkedItems, expandedItems } from '../../fileExplorer';

suite('FileExplorer Search Checkbox Display Bug', () => {
    let tempDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;
    let fileExplorer: FileExplorerProvider;
    let mockContext: vscode.ExtensionContext;

    const testFiles = {
        'scripts/install.sh': '#!/bin/bash\necho "Installing..."',
        'scripts/build.sh': '#!/bin/bash\necho "Building..."',
        'src/index.ts': 'export const main = () => {};',
        'src/utils.ts': 'export const util = () => {};',
        'README.md': '# Test Project',
        '.promptcode_ignore': ''
    };

    suiteSetup(async function() {
        this.timeout(30000);
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-search-checkbox-bug-'));
        
        for (const [relativePath, content] of Object.entries(testFiles)) {
            const fullPath = path.join(tempDir, relativePath);
            const dirPath = path.dirname(fullPath);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(fullPath, content);
        }

        workspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test-workspace',
            index: 0
        };

        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceFolder],
            writable: true,
            configurable: true
        });

        const workspaceState = new Map<string, any>();
        mockContext = {
            workspaceState: {
                get: <T>(key: string, defaultValue?: T) => workspaceState.get(key) ?? defaultValue,
                update: (key: string, value: any) => { workspaceState.set(key, value); return Promise.resolve(); }
            }
        } as any;

        fileExplorer = new FileExplorerProvider();
        (fileExplorer as any).setContext(mockContext);
        await fileExplorer.initializeWorkspaceRoots();
    });

    setup(() => {
        checkedItems.clear();
        expandedItems.clear();
        (fileExplorer as any).dirDecorationCache.clear();
    });

    suiteTeardown(() => {
        if (fileExplorer) {
            fileExplorer.dispose();
        }
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('BUG REPRODUCTION: Single file search shows checked checkbox when file is NOT selected', async () => {
        const installShPath = path.join(tempDir, 'scripts', 'install.sh');
        
        // Step 1: Verify file is NOT in checkedItems
        assert.strictEqual(checkedItems.has(installShPath), false, 'File should NOT be in checkedItems initially');
        assert.strictEqual(checkedItems.get(installShPath), undefined, 'File should have undefined checkbox state');
        
        // Step 2: Search for the file
        await fileExplorer.setSearchTerm('install.sh');
        
        // Wait for search to complete
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Step 3: Get the tree items that would be displayed
        const roots = await fileExplorer.getChildren();
        assert.ok(roots && roots.length > 0, 'Should have workspace root');
        
        // Navigate to scripts folder
        const scriptsItems = await fileExplorer.getChildren(roots[0]);
        const scriptsFolder = scriptsItems?.find(item => item.label === 'scripts');
        assert.ok(scriptsFolder, 'Should find scripts folder in search results');
        
        // Get files in scripts folder
        const files = await fileExplorer.getChildren(scriptsFolder);
        const installFile = files?.find(item => item.label === 'install.sh');
        assert.ok(installFile, 'Should find install.sh in search results');
        
        // Step 4: Check the checkbox state of the found file
        console.log('File checkbox state:', installFile.checkboxState);
        console.log('Expected state:', vscode.TreeItemCheckboxState.Unchecked);
        console.log('Actual checkedItems.get():', checkedItems.get(installShPath));
        
        // The bug: The file appears checked in UI even though it's not selected
        assert.strictEqual(
            installFile.checkboxState, 
            vscode.TreeItemCheckboxState.Unchecked,
            'BUG: File checkbox should be Unchecked but appears checked in UI'
        );
        
        // Verify the file is still not in checkedItems
        assert.strictEqual(checkedItems.has(installShPath), false, 'File should still NOT be in checkedItems after search');
    });

    test('EXPECTED BEHAVIOR: File checkbox reflects actual selection state', async () => {
        const buildShPath = path.join(tempDir, 'scripts', 'build.sh');
        
        // Step 1: Actually select the file
        checkedItems.set(buildShPath, vscode.TreeItemCheckboxState.Checked);
        
        // Step 2: Search for the file
        await fileExplorer.setSearchTerm('build.sh');
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Step 3: Get the tree items
        const roots = await fileExplorer.getChildren();
        const scriptsItems = await fileExplorer.getChildren(roots![0]);
        const scriptsFolder = scriptsItems?.find(item => item.label === 'scripts');
        const files = await fileExplorer.getChildren(scriptsFolder!);
        const buildFile = files?.find(item => item.label === 'build.sh');
        
        // Step 4: Verify checkbox state matches selection
        assert.strictEqual(
            buildFile!.checkboxState,
            vscode.TreeItemCheckboxState.Checked,
            'Selected file should show as checked'
        );
        
        // Step 5: Unselect and verify
        checkedItems.delete(buildShPath);
        
        // Refresh the search
        await fileExplorer.setSearchTerm('');
        await fileExplorer.setSearchTerm('build.sh');
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Get the file again
        const roots2 = await fileExplorer.getChildren();
        const scriptsItems2 = await fileExplorer.getChildren(roots2![0]);
        const scriptsFolder2 = scriptsItems2?.find(item => item.label === 'scripts');
        const files2 = await fileExplorer.getChildren(scriptsFolder2!);
        const buildFile2 = files2?.find(item => item.label === 'build.sh');
        
        assert.strictEqual(
            buildFile2!.checkboxState,
            vscode.TreeItemCheckboxState.Unchecked,
            'Unselected file should show as unchecked'
        );
    });

    test('VISUAL INSPECTION: Log actual checkbox states during search', async () => {
        console.log('\n=== VISUAL CHECKBOX STATE INSPECTION ===');
        
        // Clear everything
        checkedItems.clear();
        
        // Search for install.sh
        await fileExplorer.setSearchTerm('install.sh');
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Get the tree structure
        const roots = await fileExplorer.getChildren();
        if (roots && roots.length > 0) {
            console.log(`Root: ${roots[0].label}`);
            console.log(`  checkboxState: ${roots[0].checkboxState}`);
            
            const level1 = await fileExplorer.getChildren(roots[0]);
            if (level1) {
                for (const item of level1) {
                    console.log(`  ${item.label}:`);
                    console.log(`    checkboxState: ${item.checkboxState}`);
                    console.log(`    contextValue: ${item.contextValue}`);
                    
                    if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                        const level2 = await fileExplorer.getChildren(item);
                        if (level2) {
                            for (const subItem of level2) {
                                console.log(`    ${subItem.label}:`);
                                console.log(`      checkboxState: ${subItem.checkboxState}`);
                                console.log(`      In checkedItems: ${checkedItems.has(subItem.fullPath)}`);
                                console.log(`      TreeItemCheckboxState values:`);
                                console.log(`        Unchecked = ${vscode.TreeItemCheckboxState.Unchecked}`);
                                console.log(`        Checked = ${vscode.TreeItemCheckboxState.Checked}`);
                            }
                        }
                    }
                }
            }
        }
        
        console.log('\n=== END INSPECTION ===\n');
    });
});