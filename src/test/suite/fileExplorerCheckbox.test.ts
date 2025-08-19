import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileExplorerProvider, FileItem, checkedItems, expandedItems } from '../../fileExplorer';

suite('FileExplorer Checkbox Behavior Tests', () => {
    let tempDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;
    let fileExplorer: FileExplorerProvider;
    let mockTreeView: vscode.TreeView<FileItem>;
    let mockContext: vscode.ExtensionContext;

    // Simple test files structure for checkbox testing
    const testFiles = {
        'file1.txt': 'content1',
        'file2.txt': 'content2',
        'dir1/file3.txt': 'content3',
        'dir1/file4.txt': 'content4',
        'dir1/subdir/file5.txt': 'content5',
        'dir2/file6.txt': 'content6'
    };

    suiteSetup(async function() {
        this.timeout(30000);

        // Create temporary directory and test structure
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-checkbox-test-'));
        
        for (const [relativePath, content] of Object.entries(testFiles)) {
            const fullPath = path.join(tempDir, relativePath);
            const dirPath = path.dirname(fullPath);
            
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(fullPath, content);
        }

        // Setup workspace
        const workspaceUri = vscode.Uri.file(tempDir);
        workspaceFolder = {
            uri: workspaceUri,
            name: path.basename(tempDir),
            index: 0
        };

        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceFolder],
            writable: true,
            configurable: true
        });

        // Create mock context
        const workspaceState = new Map<string, any>();
        mockContext = {
            workspaceState: {
                get: <T>(key: string, defaultValue?: T) => workspaceState.get(key) ?? defaultValue,
                update: (key: string, value: any) => { workspaceState.set(key, value); return Promise.resolve(); }
            }
        } as any;

        // Initialize file explorer
        fileExplorer = new FileExplorerProvider();
        fileExplorer.setContext(mockContext);

        // Create mock tree view with expand/collapse tracking
        let onDidExpandElementCallback: ((e: vscode.TreeViewExpansionEvent<FileItem>) => void) | undefined;
        let onDidCollapseElementCallback: ((e: vscode.TreeViewExpansionEvent<FileItem>) => void) | undefined;

        mockTreeView = {
            reveal: async (element: FileItem, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
                if (options?.expand && element.isDirectory) {
                    expandedItems.set(element.fullPath, true);
                    if (onDidExpandElementCallback) {
                        onDidExpandElementCallback({ element });
                    }
                }
            },
            onDidExpandElement: (callback: (e: vscode.TreeViewExpansionEvent<FileItem>) => void) => {
                onDidExpandElementCallback = callback;
                return { dispose: () => {} };
            },
            onDidCollapseElement: (callback: (e: vscode.TreeViewExpansionEvent<FileItem>) => void) => {
                onDidCollapseElementCallback = callback;
                return { dispose: () => {} };
            }
        } as any;

        fileExplorer.setTreeView(mockTreeView);

        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    setup(() => {
        // Clear state before each test
        checkedItems.clear();
        expandedItems.clear();
    });

    suiteTeardown(() => {
        if (fileExplorer) {
            fileExplorer.dispose();
        }
        
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('File Selection', () => {
        test('should check individual files', async () => {
            const file1Path = path.join(tempDir, 'file1.txt');
            const fileUri = vscode.Uri.file(file1Path);
            const fileItem = new FileItem(
                fileUri,
                vscode.TreeItemCollapsibleState.None,
                false,
                file1Path
            );

            // Check the file
            fileExplorer.handleCheckboxToggle(fileItem, vscode.TreeItemCheckboxState.Checked);
            
            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 100));

            assert.strictEqual(
                checkedItems.get(file1Path),
                vscode.TreeItemCheckboxState.Checked,
                'File should be checked'
            );
        });

        test('should uncheck individual files', async () => {
            const file1Path = path.join(tempDir, 'file1.txt');
            const fileUri = vscode.Uri.file(file1Path);
            const fileItem = new FileItem(
                fileUri,
                vscode.TreeItemCollapsibleState.None,
                false,
                file1Path
            );

            // First check the file
            fileExplorer.handleCheckboxToggle(fileItem, vscode.TreeItemCheckboxState.Checked);
            await new Promise(resolve => setTimeout(resolve, 100));

            // Then uncheck it
            fileExplorer.handleCheckboxToggle(fileItem, vscode.TreeItemCheckboxState.Unchecked);
            await new Promise(resolve => setTimeout(resolve, 100));

            // When unchecked, the entry is deleted (not stored as Unchecked)
            assert.strictEqual(
                checkedItems.get(file1Path),
                undefined,
                'File entry should be deleted when unchecked'
            );
        });
    });

    suite('Directory Selection', () => {
        test('should check all files in directory when directory is checked', async () => {
            const dir1Path = path.join(tempDir, 'dir1');
            const dirUri = vscode.Uri.file(dir1Path);
            const dirItem = new FileItem(
                dirUri,
                vscode.TreeItemCollapsibleState.Collapsed,
                true,
                dir1Path
            );

            // Check the directory
            fileExplorer.handleCheckboxToggle(dirItem, vscode.TreeItemCheckboxState.Checked);
            
            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 200));

            // All files in dir1 should be checked
            const file3Path = path.join(tempDir, 'dir1', 'file3.txt');
            const file4Path = path.join(tempDir, 'dir1', 'file4.txt');
            const file5Path = path.join(tempDir, 'dir1', 'subdir', 'file5.txt');

            assert.strictEqual(
                checkedItems.get(file3Path),
                vscode.TreeItemCheckboxState.Checked,
                'file3.txt should be checked when parent directory is checked'
            );
            assert.strictEqual(
                checkedItems.get(file4Path),
                vscode.TreeItemCheckboxState.Checked,
                'file4.txt should be checked when parent directory is checked'
            );
            assert.strictEqual(
                checkedItems.get(file5Path),
                vscode.TreeItemCheckboxState.Checked,
                'file5.txt should be checked when parent directory is checked'
            );
        });

        test('should uncheck all files in directory when directory is unchecked', async () => {
            const dir1Path = path.join(tempDir, 'dir1');
            const dirUri = vscode.Uri.file(dir1Path);
            const dirItem = new FileItem(
                dirUri,
                vscode.TreeItemCollapsibleState.Collapsed,
                true,
                dir1Path
            );

            // First check the directory
            fileExplorer.handleCheckboxToggle(dirItem, vscode.TreeItemCheckboxState.Checked);
            await new Promise(resolve => setTimeout(resolve, 200));

            // Then uncheck it
            fileExplorer.handleCheckboxToggle(dirItem, vscode.TreeItemCheckboxState.Unchecked);
            await new Promise(resolve => setTimeout(resolve, 200));

            // All files in dir1 should have their entries deleted (not stored as Unchecked)
            const file3Path = path.join(tempDir, 'dir1', 'file3.txt');
            const file4Path = path.join(tempDir, 'dir1', 'file4.txt');
            const file5Path = path.join(tempDir, 'dir1', 'subdir', 'file5.txt');

            assert.strictEqual(
                checkedItems.get(file3Path),
                undefined,
                'file3.txt entry should be deleted when parent directory is unchecked'
            );
            assert.strictEqual(
                checkedItems.get(file4Path),
                undefined,
                'file4.txt entry should be deleted when parent directory is unchecked'
            );
            assert.strictEqual(
                checkedItems.get(file5Path),
                undefined,
                'file5.txt entry should be deleted when parent directory is unchecked'
            );
        });
    });

    suite('Parent State Updates', () => {
        test('should update parent state when child is checked', async () => {
            const file3Path = path.join(tempDir, 'dir1', 'file3.txt');
            const fileUri = vscode.Uri.file(file3Path);
            const fileItem = new FileItem(
                fileUri,
                vscode.TreeItemCollapsibleState.None,
                false,
                file3Path
            );

            // Check a file in dir1
            fileExplorer.handleCheckboxToggle(fileItem, vscode.TreeItemCheckboxState.Checked);
            
            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 200));

            // Parent directory should reflect the partial selection
            const dir1Path = path.join(tempDir, 'dir1');
            const parentState = checkedItems.get(dir1Path);
            
            // Since only one file is checked but not all, parent should be unchecked
            // (VS Code doesn't have a mixed state, so it defaults to unchecked)
            // With delete-on-uncheck, mixed state means no entry (undefined)
            assert.strictEqual(
                parentState,
                undefined,
                'Parent directory should have no entry (undefined) when only some children are checked'
            );
        });

        test('should update parent state when all children are checked', async () => {
            // Check all individual files in dir1
            const dir1Files = [
                path.join(tempDir, 'dir1', 'file3.txt'),
                path.join(tempDir, 'dir1', 'file4.txt'),
                path.join(tempDir, 'dir1', 'subdir', 'file5.txt')
            ];

            for (const filePath of dir1Files) {
                const fileUri = vscode.Uri.file(filePath);
                const fileItem = new FileItem(
                    fileUri,
                    vscode.TreeItemCollapsibleState.None,
                    false,
                    filePath
                );
                fileExplorer.handleCheckboxToggle(fileItem, vscode.TreeItemCheckboxState.Checked);
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // Wait for final parent update
            await new Promise(resolve => setTimeout(resolve, 200));

            // Parent directory should now be checked since all children are checked
            const dir1Path = path.join(tempDir, 'dir1');
            const parentState = checkedItems.get(dir1Path);
            
            assert.strictEqual(
                parentState,
                vscode.TreeItemCheckboxState.Checked,
                'Parent directory should be checked when all children are checked'
            );
        });

        test('should update nested parent states correctly', async () => {
            const subdirPath = path.join(tempDir, 'dir1', 'subdir');
            const subdirUri = vscode.Uri.file(subdirPath);
            const subdirItem = new FileItem(
                subdirUri,
                vscode.TreeItemCollapsibleState.Collapsed,
                true,
                subdirPath
            );

            // Check the subdirectory
            fileExplorer.handleCheckboxToggle(subdirItem, vscode.TreeItemCheckboxState.Checked);
            
            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 200));

            // file5.txt should be checked
            const file5Path = path.join(tempDir, 'dir1', 'subdir', 'file5.txt');
            assert.strictEqual(
                checkedItems.get(file5Path),
                vscode.TreeItemCheckboxState.Checked,
                'file5.txt should be checked when subdir is checked'
            );

            // Parent dir1 should have some state reflecting partial selection
            const dir1Path = path.join(tempDir, 'dir1');
            const parentState = checkedItems.get(dir1Path);
            
            // Since not all files in dir1 are checked (only the subdir), parent should be unchecked
            // With delete-on-uncheck, mixed state means no entry (undefined)
            assert.strictEqual(
                parentState,
                undefined,
                'Parent directory should have no entry (undefined) when only some descendants are checked'
            );
        });
    });

    suite('Programmatic Selection', () => {
        test('should select files by relative paths', async () => {
            const relativePaths = ['file1.txt', 'dir1/file3.txt'];
            
            await fileExplorer.selectFiles(relativePaths);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 200));

            const file1Path = path.join(tempDir, 'file1.txt');
            const file3Path = path.join(tempDir, 'dir1', 'file3.txt');

            assert.strictEqual(
                checkedItems.get(file1Path),
                vscode.TreeItemCheckboxState.Checked,
                'file1.txt should be selected'
            );
            assert.strictEqual(
                checkedItems.get(file3Path),
                vscode.TreeItemCheckboxState.Checked,
                'dir1/file3.txt should be selected'
            );
        });

        test('should add to existing selection when requested', async () => {
            // First select one file
            const file1Path = path.join(tempDir, 'file1.txt');
            checkedItems.set(file1Path, vscode.TreeItemCheckboxState.Checked);

            // Then add more files
            const additionalPaths = ['file2.txt', 'dir1/file4.txt'];
            await fileExplorer.selectFiles(additionalPaths, true);
            
            await new Promise(resolve => setTimeout(resolve, 200));

            // Original selection should still be there
            assert.strictEqual(
                checkedItems.get(file1Path),
                vscode.TreeItemCheckboxState.Checked,
                'Original selection should be preserved'
            );

            // New selections should be added
            const file2Path = path.join(tempDir, 'file2.txt');
            const file4Path = path.join(tempDir, 'dir1', 'file4.txt');

            assert.strictEqual(
                checkedItems.get(file2Path),
                vscode.TreeItemCheckboxState.Checked,
                'file2.txt should be added to selection'
            );
            assert.strictEqual(
                checkedItems.get(file4Path),
                vscode.TreeItemCheckboxState.Checked,
                'dir1/file4.txt should be added to selection'
            );
        });

        test('should clear existing selection when not adding', async () => {
            // First select some files
            const file1Path = path.join(tempDir, 'file1.txt');
            const file2Path = path.join(tempDir, 'file2.txt');
            checkedItems.set(file1Path, vscode.TreeItemCheckboxState.Checked);
            checkedItems.set(file2Path, vscode.TreeItemCheckboxState.Checked);

            // Then select different files without adding
            const newPaths = ['dir1/file3.txt'];
            await fileExplorer.selectFiles(newPaths, false);
            
            await new Promise(resolve => setTimeout(resolve, 200));

            // Original selections should be cleared
            assert.notStrictEqual(
                checkedItems.get(file1Path),
                vscode.TreeItemCheckboxState.Checked,
                'Original selection should be cleared'
            );
            assert.notStrictEqual(
                checkedItems.get(file2Path),
                vscode.TreeItemCheckboxState.Checked,
                'Original selection should be cleared'
            );

            // New selection should be there
            const file3Path = path.join(tempDir, 'dir1', 'file3.txt');
            assert.strictEqual(
                checkedItems.get(file3Path),
                vscode.TreeItemCheckboxState.Checked,
                'New selection should be set'
            );
        });

        test('should get selected paths as relative paths', async () => {
            // Select some files
            const file1Path = path.join(tempDir, 'file1.txt');
            const file3Path = path.join(tempDir, 'dir1', 'file3.txt');
            checkedItems.set(file1Path, vscode.TreeItemCheckboxState.Checked);
            checkedItems.set(file3Path, vscode.TreeItemCheckboxState.Checked);

            const selectedPaths = fileExplorer.getSelectedPaths();

            assert.ok(selectedPaths.includes('file1.txt'), 'Should include file1.txt');
            assert.ok(selectedPaths.includes('dir1/file3.txt'), 'Should include dir1/file3.txt');
            assert.strictEqual(selectedPaths.length, 2, 'Should return exactly 2 selected paths');
        });
    });

    suite('Checkbox State Consistency', () => {
        test('should ignore no-op checkbox toggles', async () => {
            const file1Path = path.join(tempDir, 'file1.txt');
            const fileUri = vscode.Uri.file(file1Path);
            const fileItem = new FileItem(
                fileUri,
                vscode.TreeItemCollapsibleState.None,
                false,
                file1Path
            );

            // Set initial state
            checkedItems.set(file1Path, vscode.TreeItemCheckboxState.Checked);

            // Try to toggle to the same state (should be ignored)
            fileExplorer.handleCheckboxToggle(fileItem, vscode.TreeItemCheckboxState.Checked);
            
            await new Promise(resolve => setTimeout(resolve, 100));

            // State should remain the same
            assert.strictEqual(
                checkedItems.get(file1Path),
                vscode.TreeItemCheckboxState.Checked,
                'State should remain unchanged for no-op toggles'
            );
        });

        test('should handle rapid checkbox toggles gracefully', async () => {
            const file1Path = path.join(tempDir, 'file1.txt');
            const fileUri = vscode.Uri.file(file1Path);
            const fileItem = new FileItem(
                fileUri,
                vscode.TreeItemCollapsibleState.None,
                false,
                file1Path
            );

            // Rapidly toggle the checkbox
            fileExplorer.handleCheckboxToggle(fileItem, vscode.TreeItemCheckboxState.Checked);
            fileExplorer.handleCheckboxToggle(fileItem, vscode.TreeItemCheckboxState.Unchecked);
            fileExplorer.handleCheckboxToggle(fileItem, vscode.TreeItemCheckboxState.Checked);
            
            // Wait for all processing to complete
            await new Promise(resolve => setTimeout(resolve, 300));

            // Final state should be checked
            assert.strictEqual(
                checkedItems.get(file1Path),
                vscode.TreeItemCheckboxState.Checked,
                'Final state should reflect last toggle'
            );
        });
    });
});