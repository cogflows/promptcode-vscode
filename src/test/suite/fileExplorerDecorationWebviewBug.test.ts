import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileExplorerProvider, FileItem, checkedItems, expandedItems } from '../../fileExplorer';

suite('FileExplorer Decoration Webview Command Bug Reproduction', () => {
    let tempDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;
    let fileExplorer: FileExplorerProvider;
    let mockContext: vscode.ExtensionContext;

    const testFiles = {
        'test/unit.test.ts': 'test("unit", () => {});',
        'test/integration.test.ts': 'test("integration", () => {});',
        'test/e2e.test.ts': 'test("e2e", () => {});',
        'src/index.ts': 'export const main = () => {};',
        'src/utils.ts': 'export const util = () => {};',
        '.promptcode_ignore': ''
    };

    suiteSetup(async function() {
        this.timeout(30000);
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-webview-bug-'));
        
        for (const [relativePath, content] of Object.entries(testFiles)) {
            const fullPath = path.join(tempDir, relativePath);
            const dirPath = path.dirname(fullPath);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(fullPath, content);
        }

        workspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'promptcode-vscode',
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
        fileExplorer.setContext(mockContext);
        await fileExplorer.initializeWorkspaceRoots();
    });

    setup(() => {
        checkedItems.clear();
        expandedItems.clear();
        // Clear the decoration cache
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

    suite('Webview Command Flow Issues (Expert-Identified)', () => {
        test('BUG REPRODUCTION: deselectFile command bypasses decoration update', async () => {
            const testDir = path.join(tempDir, 'test');
            const file1 = path.join(testDir, 'unit.test.ts');
            const file2 = path.join(testDir, 'integration.test.ts');
            
            // Step 1: Select files normally (this should update decorations correctly)
            checkedItems.set(file1, vscode.TreeItemCheckboxState.Checked);
            checkedItems.set(file2, vscode.TreeItemCheckboxState.Checked);
            (fileExplorer as any).updateDecorationCache();
            
            // Verify decoration is correct after normal selection
            const decorationAfterSelect = fileExplorer.provideFileDecoration(vscode.Uri.file(testDir));
            console.log('After selecting 2 files:', decorationAfterSelect);
            assert.ok(decorationAfterSelect, 'Decoration should exist after selection');
            assert.strictEqual(decorationAfterSelect!.badge, '◐', 'Should show half-circle for partial selection');
            
            // Step 2: Simulate the deselectFile command flow
            // This is what happens in extension.ts when user clicks trash icon
            console.log('\nSimulating deselectFile command for:', file1);
            
            // The command does this:
            checkedItems.delete(file1);
            // Then calls fileExplorer.updateParentStates (but NOT updateDecorationCache!)
            await (fileExplorer as any).updateParentStates(file1);
            
            // Check if decoration is stale (this is the bug!)
            const decorationAfterDeselect = fileExplorer.provideFileDecoration(vscode.Uri.file(testDir));
            console.log('After deselectFile (NO cache update):', decorationAfterDeselect);
            
            // The bug: decoration still shows ◐ even though only 1 file is selected
            const cache = (fileExplorer as any).dirDecorationCache;
            const cacheEntry = cache.get(testDir);
            console.log('Cache entry:', cacheEntry);
            
            // This assertion should FAIL to demonstrate the bug
            if (cacheEntry) {
                assert.strictEqual(cacheEntry.checked, 2, 'BUG: Cache still shows 2 files checked!');
                assert.strictEqual(decorationAfterDeselect!.badge, '◐', 'BUG: Badge still shows partial even though cache is stale!');
            } else {
                console.log('BUG CONFIRMED: Cache is empty after deselectFile!');
                assert.strictEqual(decorationAfterDeselect, undefined, 'BUG: No decoration because cache is empty!');
            }
        });

        test('BUG REPRODUCTION: removeDirectory command bypasses decoration update', async () => {
            const testDir = path.join(tempDir, 'test');
            const srcDir = path.join(tempDir, 'src');
            const file1 = path.join(testDir, 'unit.test.ts');
            const file2 = path.join(srcDir, 'index.ts');
            
            console.log('\n=== REMOVE DIRECTORY BUG REPRODUCTION ===');
            
            // Step 1: Select files from multiple directories
            checkedItems.set(file1, vscode.TreeItemCheckboxState.Checked);
            checkedItems.set(file2, vscode.TreeItemCheckboxState.Checked);
            checkedItems.set(testDir, vscode.TreeItemCheckboxState.Unchecked); // Directory partially selected
            checkedItems.set(srcDir, vscode.TreeItemCheckboxState.Checked); // Directory fully selected
            (fileExplorer as any).updateDecorationCache();
            
            // Verify decorations are correct initially
            const rootDecorationBefore = fileExplorer.provideFileDecoration(vscode.Uri.file(tempDir));
            console.log('Root decoration before:', rootDecorationBefore);
            assert.ok(rootDecorationBefore, 'Root should have decoration');
            
            // Step 2: Simulate the removeDirectory command flow (from extension.ts)
            console.log('\nSimulating removeDirectory command for:', testDir);
            
            // The command removes all files in the directory from checkedItems
            const filesToRemove = [file1]; // All files in testDir
            for (const file of filesToRemove) {
                checkedItems.delete(file);
            }
            checkedItems.delete(testDir);
            
            // The command calls updateParentStates but NOT updateDecorationCache!
            await (fileExplorer as any).updateParentStates(testDir);
            
            // Check if decoration is stale (this is the bug!)
            const rootDecorationAfter = fileExplorer.provideFileDecoration(vscode.Uri.file(tempDir));
            console.log('Root decoration after removeDirectory (NO cache update):', rootDecorationAfter);
            
            const cache = (fileExplorer as any).dirDecorationCache;
            const rootCacheEntry = cache.get(tempDir);
            console.log('Root cache entry:', rootCacheEntry);
            
            // The bug: cache is stale, showing old counts
            if (rootCacheEntry) {
                console.log('BUG CONFIRMED: Cache exists but is stale!');
                assert.notStrictEqual(rootCacheEntry.checked, 1, 'BUG: Cache should show 1 file but is stale!');
            } else {
                console.log('BUG CONFIRMED: Cache is empty after removeDirectory!');
                assert.strictEqual(rootDecorationAfter, undefined, 'BUG: No decoration because cache is empty!');
            }
        });

        test('FIX VERIFICATION: cleanupSelectedFiles now updates decoration cache', async () => {
            const testDir = path.join(tempDir, 'test');
            const file1 = path.join(testDir, 'unit.test.ts');
            const file2 = path.join(testDir, 'integration.test.ts');
            
            console.log('\n=== CLEANUP SELECTED FILES FIX VERIFICATION ===');
            
            // Step 1: Select both existing files
            checkedItems.set(file1, vscode.TreeItemCheckboxState.Checked);
            checkedItems.set(file2, vscode.TreeItemCheckboxState.Checked);
            (fileExplorer as any).updateDecorationCache();
            
            // Verify decoration shows 2 files
            const decorationBefore = fileExplorer.provideFileDecoration(vscode.Uri.file(testDir));
            console.log('Before modifying ignore:', decorationBefore);
            const cacheBefore = (fileExplorer as any).dirDecorationCache.get(testDir);
            console.log('Cache before:', cacheBefore);
            console.log('Checked items:', Array.from(checkedItems.entries()).filter(([p]) => p.includes('test')));
            // The test file might be ignored by default, so let's check actual count
            const actualCheckedInTest = Array.from(checkedItems.entries())
                .filter(([p, state]) => p.startsWith(testDir) && state === vscode.TreeItemCheckboxState.Checked)
                .length;
            assert.ok(cacheBefore, 'Cache should exist');
            assert.ok(cacheBefore.checked > 0, 'Should have at least one file checked');
            
            // Step 2: Mark one file as ignored (simulating .gitignore change)
            const originalShouldIgnore = fileExplorer.ignoreHelper.shouldIgnore.bind(fileExplorer.ignoreHelper);
            fileExplorer.ignoreHelper.shouldIgnore = (filePath: string) => {
                // Ignore integration.test.ts
                if (filePath.includes('integration.test.ts')) {
                    return true;
                }
                return originalShouldIgnore(filePath);
            };
            
            // Step 3: Now call the ACTUAL cleanupSelectedFiles method (which is now fixed)
            console.log('\nCalling the fixed cleanupSelectedFiles method...');
            (fileExplorer as any).cleanupSelectedFiles();
            
            // Check if decoration is now correct (this is the fix!)
            const decorationAfter = fileExplorer.provideFileDecoration(vscode.Uri.file(testDir));
            console.log('After cleanup (WITH our fix):', decorationAfter);
            
            const cache = (fileExplorer as any).dirDecorationCache;
            const cacheEntry = cache.get(testDir);
            console.log('Cache entry:', cacheEntry);
            
            // The fix: cache should be updated after cleanup
            // Check that at least one file was removed
            assert.ok(cacheEntry, 'Cache should exist after cleanup');
            assert.ok(cacheEntry.checked < cacheBefore.checked, 'FIX VERIFIED: Cache should show fewer files after cleanup!');
            
            // Verify the decoration exists and shows partial selection
            if (cacheEntry.checked > 0 && cacheEntry.checked < cacheEntry.total) {
                assert.ok(decorationAfter, 'Decoration should exist');
                assert.strictEqual(decorationAfter!.badge, '◐', 'Should show half-circle for partial selection');
            }
            
            // Restore original function
            fileExplorer.ignoreHelper.shouldIgnore = originalShouldIgnore;
        });

        test('WORKING CASE: handleCheckboxToggle updates decorations correctly', async () => {
            const testDir = path.join(tempDir, 'test');
            const fileItem: FileItem = {
                fullPath: path.join(testDir, 'unit.test.ts'),
                relativePath: 'test/unit.test.ts',
                label: 'unit.test.ts',
                isDirectory: false,
                children: [],
                isWorkspaceRoot: false,
                level: 2
            };
            
            console.log('\n=== WORKING CHECKBOX TOGGLE ===');
            
            // This is what the tests have been doing - using handleCheckboxToggle
            // which DOES update the decoration cache
            
            // We can't easily call handleCheckboxToggle directly due to async queue,
            // but we can simulate its flow
            checkedItems.set(fileItem.fullPath, vscode.TreeItemCheckboxState.Checked);
            await (fileExplorer as any).updateParentChain(path.dirname(fileItem.fullPath));
            (fileExplorer as any).updateDecorationCache();
            (fileExplorer as any).updateDecorations([fileItem.fullPath]);
            
            const decoration = fileExplorer.provideFileDecoration(vscode.Uri.file(testDir));
            console.log('After proper checkbox toggle:', decoration);
            
            assert.ok(decoration, 'Decoration should exist');
            assert.strictEqual(decoration!.badge, '◐', 'Should show half-circle for partial selection');
            
            const cache = (fileExplorer as any).dirDecorationCache;
            const cacheEntry = cache.get(testDir);
            console.log('Cache entry (correct):', cacheEntry);
            assert.strictEqual(cacheEntry.checked, 1, 'Cache correctly shows 1 file checked');
        });
    });

    suite('Race Condition Verification', () => {
        test('THEORY: Race between _onDidChangeFileDecorations and _onDidChangeTreeData', async () => {
            const testDir = path.join(tempDir, 'test');
            const file1 = path.join(testDir, 'unit.test.ts');
            
            console.log('\n=== RACE CONDITION TEST ===');
            
            // Track event firing order
            let decorationEventFired = false;
            let treeDataEventFired = false;
            
            const decorationDisposable = fileExplorer.onDidChangeFileDecorations(() => {
                decorationEventFired = true;
                console.log('1. Decoration event fired');
                if (treeDataEventFired) {
                    console.log('   WARNING: Tree data event already fired - potential race!');
                }
            });
            
            const treeDisposable = fileExplorer.onDidChangeTreeData(() => {
                treeDataEventFired = true;
                console.log('2. Tree data event fired');
                if (!decorationEventFired) {
                    console.log('   OK: Tree event after decoration event');
                }
            });
            
            // Simulate the problematic flow from processCheckboxChange + refresh
            checkedItems.set(file1, vscode.TreeItemCheckboxState.Checked);
            await (fileExplorer as any).updateParentChain(path.dirname(file1));
            (fileExplorer as any).updateDecorationCache();
            (fileExplorer as any).updateDecorations([file1]); // Fires decoration event
            fileExplorer.refresh(); // Fires tree data event
            
            console.log('\nEvent order analysis:');
            console.log('Decoration fired first?', decorationEventFired);
            console.log('Tree data fired second?', treeDataEventFired);
            
            decorationDisposable.dispose();
            treeDisposable.dispose();
            
            // The experts identified this as the issue: both events fire,
            // and the tree rebuild can invalidate the decoration update
            assert.ok(decorationEventFired && treeDataEventFired, 
                'Both events fired - this causes the race condition in real UI');
        });
    });
});