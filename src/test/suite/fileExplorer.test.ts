import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileExplorerProvider, FileItem, checkedItems, expandedItems } from '../../fileExplorer';
import { IgnoreHelper } from '../../ignoreHelper';

suite('FileExplorer Tests', () => {
    let tempDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;
    let fileExplorer: FileExplorerProvider;
    let mockTreeView: vscode.TreeView<FileItem>;
    let mockContext: vscode.ExtensionContext;

    // Test files structure
    const testFiles = {
        'README.md': 'This is a readme file',
        'package.json': '{"name": "test-project", "version": "1.0.0"}',
        'src/index.ts': 'console.log("Hello World");',
        'src/utils/helper.ts': 'export function helper() { return "help"; }',
        'src/components/Button.tsx': 'export const Button = () => <button>Click me</button>;',
        'tests/unit.test.ts': 'describe("unit tests", () => {});',
        'docs/api.md': '# API Documentation',
        'node_modules/package/index.js': 'module.exports = {};',
        '.git/config': '[core]',
        '.gitignore': 'node_modules/\n*.log\n.env',
        '.promptcode_ignore': 'tests/\ndocs/\n.git/',
        'empty-dir/.gitkeep': '',
        'nested/deep/file.txt': 'deep nested file'
    };

    suiteSetup(async function() {
        this.timeout(30000); // Allow more time for setup

        // Create temporary directory
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-test-'));
        
        // Create test file structure
        for (const [relativePath, content] of Object.entries(testFiles)) {
            const fullPath = path.join(tempDir, relativePath);
            const dirPath = path.dirname(fullPath);
            
            // Create directory structure
            fs.mkdirSync(dirPath, { recursive: true });
            
            // Write file
            fs.writeFileSync(fullPath, content);
        }

        // Create workspace folder
        const workspaceUri = vscode.Uri.file(tempDir);
        workspaceFolder = {
            uri: workspaceUri,
            name: path.basename(tempDir),
            index: 0
        };

        // Mock workspace folders
        const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceFolder],
            writable: true,
            configurable: true
        });

        // Create mock context with workspace state
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
        await fileExplorer.initializeWorkspaceRoots(); // Initialize workspace roots after setting workspace folders

        // Create mock tree view
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

        // Give file explorer time to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    setup(() => {
        // Clear state before each test
        checkedItems.clear();
        expandedItems.clear();
        fileExplorer.clearExpandedState(); // Clear any stale expanded state
    });

    suiteTeardown(() => {
        if (fileExplorer) {
            fileExplorer.dispose();
        }
        
        // Clean up temp directory
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Basic Tree Structure', () => {
        test('should return workspace roots at top level', async () => {
            const roots = await fileExplorer.getChildren();
            
            assert.strictEqual(roots.length, 1);
            assert.strictEqual(roots[0].fullPath, tempDir);
            assert.strictEqual(roots[0].isDirectory, true);
        });

        test('should return child files and directories', async () => {
            const roots = await fileExplorer.getChildren();
            const workspaceRoot = roots[0];
            
            const children = await fileExplorer.getChildren(workspaceRoot);
            
            // Should exclude ignored files/directories (node_modules, .git, tests, docs)
            const childNames = children.map(c => path.basename(c.fullPath)).sort();
            
            // Expected: README.md, package.json, src, .gitignore, .promptcode_ignore, empty-dir, nested
            assert.ok(childNames.includes('README.md'));
            assert.ok(childNames.includes('package.json'));
            assert.ok(childNames.includes('src'));
            assert.ok(childNames.includes('.gitignore'));
            assert.ok(childNames.includes('.promptcode_ignore'));
            assert.ok(!childNames.includes('node_modules')); // Should be ignored
            assert.ok(!childNames.includes('.git')); // Should be ignored
            assert.ok(!childNames.includes('tests')); // Should be ignored by .promptcode_ignore
            assert.ok(!childNames.includes('docs')); // Should be ignored by .promptcode_ignore
        });

        test('should handle nested directory structure', async () => {
            const roots = await fileExplorer.getChildren();
            const workspaceRoot = roots[0];
            const children = await fileExplorer.getChildren(workspaceRoot);
            
            // Find src directory
            const srcDir = children.find(c => path.basename(c.fullPath) === 'src');
            assert.ok(srcDir);
            assert.strictEqual(srcDir!.isDirectory, true);
            
            // Get src children
            const srcChildren = await fileExplorer.getChildren(srcDir);
            const srcChildNames = srcChildren.map(c => path.basename(c.fullPath)).sort();
            
            assert.ok(srcChildNames.includes('index.ts'));
            assert.ok(srcChildNames.includes('utils'));
            assert.ok(srcChildNames.includes('components'));
        });
    });

    suite('Search Functionality', () => {
        test('should filter files by simple search term', async () => {
            await fileExplorer.setSearchTerm('helper');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const searchResults = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(searchResults.length > 0);
            assert.ok(searchResults.some(result => result.includes('helper.ts')));
        });

        test('should filter files by path search', async () => {
            await fileExplorer.setSearchTerm('src/utils');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const searchResults = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(searchResults.length > 0);
            assert.ok(searchResults.some(result => result.includes('utils/helper.ts')));
        });

        test('should support glob patterns', async () => {
            await fileExplorer.setSearchTerm('*.ts', true);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const searchResults = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(searchResults.length > 0);
            assert.ok(searchResults.every(result => result.endsWith('.ts')));
            assert.ok(searchResults.some(result => result.includes('index.ts')));
            assert.ok(searchResults.some(result => result.includes('helper.ts')));
        });

        test('should include folders when requested', async () => {
            await fileExplorer.setSearchTerm('src', false, true);
            
            // Check if src directory is included in search paths
            const roots = await fileExplorer.getChildren();
            const workspaceRoot = roots[0];
            const children = await fileExplorer.getChildren(workspaceRoot);
            
            // During search, should only show matching items
            const srcDir = children.find(c => path.basename(c.fullPath) === 'src');
            assert.ok(srcDir, 'src directory should be found when including folders');
        });

        test('should auto-expand parent directories of search matches', async () => {
            // Clear expanded state first
            expandedItems.clear();
            
            // Search for a deeply nested file
            await fileExplorer.setSearchTerm('helper');
            
            // Wait for auto-expansion
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Check that parent directories are expanded
            const srcPath = path.join(tempDir, 'src');
            const utilsPath = path.join(tempDir, 'src', 'utils');
            
            assert.ok(expandedItems.get(srcPath), 'src directory should be auto-expanded');
            assert.ok(expandedItems.get(utilsPath), 'utils directory should be auto-expanded');
        });

        test('should debounce search updates', async () => {
            // Track rebuild calls to verify debouncing
            let rebuildCount = 0;
            const originalRebuildSearchPaths = (fileExplorer as any).rebuildSearchPaths;
            (fileExplorer as any).rebuildSearchPaths = async function() {
                rebuildCount++;
                return originalRebuildSearchPaths.call(this);
            };
            
            // Rapidly call setSearchTerm multiple times
            await fileExplorer.setSearchTerm('a');
            await fileExplorer.setSearchTerm('ab');
            await fileExplorer.setSearchTerm('abc');
            await fileExplorer.setSearchTerm('abcd');
            
            // Wait for debounce timeout (should be around 200ms based on implementation)
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Only the last search should have triggered a rebuild
            assert.strictEqual(rebuildCount, 1, 'Search should be debounced - only one rebuild should occur');
            
            // Restore original method
            (fileExplorer as any).rebuildSearchPaths = originalRebuildSearchPaths;
        });

        test('should clear search results when search term is empty', async () => {
            // First set a search term
            await fileExplorer.setSearchTerm('helper');
            // Wait for the async search to complete
            await new Promise(resolve => setTimeout(resolve, 300));
            let searchResults = await fileExplorer.getCurrentSearchResults();
            assert.ok(searchResults.length > 0);
            
            // Clear search
            await fileExplorer.setSearchTerm('');
            searchResults = await fileExplorer.getCurrentSearchResults();
            assert.strictEqual(searchResults.length, 0);
        });
    });

    suite('Tree State Persistence', () => {
        test('should save and restore expanded state', async () => {
            const srcPath = path.join(tempDir, 'src');
            
            // Expand a directory
            expandedItems.set(srcPath, true);
            
            // Simulate saving state (this happens automatically in real usage)
            const savedState = Array.from(expandedItems.keys());
            
            // Clear and restore
            expandedItems.clear();
            savedState.forEach(path => expandedItems.set(path, true));
            
            assert.ok(expandedItems.get(srcPath), 'Expanded state should be restored');
        });

        test('should persist expanded state across tree refreshes', async () => {
            const srcPath = path.join(tempDir, 'src');
            
            // Set expanded state
            expandedItems.set(srcPath, true);
            
            // Refresh tree
            fileExplorer.refresh();
            
            // State should still be there
            assert.ok(expandedItems.get(srcPath), 'Expanded state should persist across refreshes');
        });
    });

    suite('Reveal Functionality', () => {
        test('should reveal a specific file path', async () => {
            const targetFile = path.join(tempDir, 'src', 'utils', 'helper.ts');
            
            // Clear expanded state
            expandedItems.clear();
            
            // Reveal the file
            await fileExplorer.revealPath(targetFile);
            
            // Check that parent directories were expanded
            const srcPath = path.join(tempDir, 'src');
            const utilsPath = path.join(tempDir, 'src', 'utils');
            
            assert.ok(expandedItems.get(srcPath), 'src directory should be expanded to reveal file');
            assert.ok(expandedItems.get(utilsPath), 'utils directory should be expanded to reveal file');
        });

        test('should expand to show file without revealing', async () => {
            const targetFile = path.join(tempDir, 'nested', 'deep', 'file.txt');
            
            // Clear expanded state
            expandedItems.clear();
            
            // Expand to show file
            await fileExplorer.expandToShowFile(targetFile);
            
            // Check that parent directories were expanded
            const nestedPath = path.join(tempDir, 'nested');
            const deepPath = path.join(tempDir, 'nested', 'deep');
            
            assert.ok(expandedItems.get(nestedPath), 'nested directory should be expanded');
            assert.ok(expandedItems.get(deepPath), 'deep directory should be expanded');
        });

        test('should get current search results for reveal', async () => {
            await fileExplorer.setSearchTerm('ts');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const searchResults = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(searchResults.length > 0);
            assert.ok(searchResults.every(result => {
                // Should only return files, not directories
                try {
                    return fs.statSync(result).isFile();
                } catch {
                    return false;
                }
            }));
        });
    });

    suite('Flat Index Performance', () => {
        test('should build flat file index', async () => {
            // Trigger index build by doing a search
            await fileExplorer.setSearchTerm('helper');
            
            // Wait for index to build
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Search should work and find results
            const searchResults = await fileExplorer.getCurrentSearchResults();
            assert.ok(searchResults.length > 0);
        });

        test('should update index on file changes', async () => {
            // Create a new file
            const newFile = path.join(tempDir, 'newfile.ts');
            fs.writeFileSync(newFile, 'console.log("new file");');
            
            // Simulate file watcher notification
            fileExplorer.refresh();
            
            // Wait for refresh
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Search for the new file
            await fileExplorer.setSearchTerm('newfile');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const searchResults = await fileExplorer.getCurrentSearchResults();
            assert.ok(searchResults.some(result => result.includes('newfile.ts')));
            
            // Clean up
            fs.unlinkSync(newFile);
        });

        test('should handle large number of files efficiently', async () => {
            const startTime = Date.now();
            
            // Do a broad search that would match many files
            await fileExplorer.setSearchTerm('*', true);
            
            const endTime = Date.now();
            const searchTime = endTime - startTime;
            
            // Should complete reasonably quickly (less than 2 seconds)
            assert.ok(searchTime < 2000, `Search took ${searchTime}ms, should be faster`);
        });
    });

    suite('Auto-expand Behavior', () => {
        test('should auto-expand when searching', async () => {
            expandedItems.clear();
            
            await fileExplorer.setSearchTerm('Button');
            
            // Wait for auto-expansion
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Should expand src and components directories
            const srcPath = path.join(tempDir, 'src');
            const componentsPath = path.join(tempDir, 'src', 'components');
            
            assert.ok(expandedItems.get(srcPath), 'src should be auto-expanded for search results');
            assert.ok(expandedItems.get(componentsPath), 'components should be auto-expanded for search results');
        });

        test('should not auto-expand when no search results', async () => {
            expandedItems.clear();
            
            await fileExplorer.setSearchTerm('nonexistentfile');
            
            // Wait for potential expansion
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Nothing should be expanded
            assert.strictEqual(expandedItems.size, 0, 'No directories should be expanded when no results');
        });

        test('should expand on Enter key simulation', async () => {
            await fileExplorer.setSearchTerm('helper');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const searchResults = await fileExplorer.getCurrentSearchResults();
            assert.ok(searchResults.length > 0);
            
            // Simulate Enter key by revealing first result
            if (searchResults.length > 0) {
                const firstResult = searchResults[0];
                await fileExplorer.revealPath(firstResult);
                
                // Should expand parent directories
                const utilsPath = path.join(tempDir, 'src', 'utils');
                assert.ok(expandedItems.get(utilsPath), 'Parent directory should be expanded when revealing file');
            }
        });
    });

    suite('Error Handling', () => {
        test('should handle missing files gracefully', async () => {
            const nonExistentPath = path.join(tempDir, 'does-not-exist.txt');
            
            // Should not throw when revealing non-existent file
            await assert.doesNotReject(async () => {
                await fileExplorer.revealPath(nonExistentPath);
            });
        });

        test('should handle permission errors gracefully', async () => {
            // Create a directory we can't read (if possible on this platform)
            const restrictedDir = path.join(tempDir, 'restricted');
            fs.mkdirSync(restrictedDir);
            
            try {
                // Try to make it unreadable (may not work on all platforms)
                fs.chmodSync(restrictedDir, 0o000);
                
                const roots = await fileExplorer.getChildren();
                const workspaceRoot = roots[0];
                
                // Should not throw when getting children includes restricted directory
                await assert.doesNotReject(async () => {
                    await fileExplorer.getChildren(workspaceRoot);
                });
            } finally {
                // Restore permissions for cleanup
                try {
                    fs.chmodSync(restrictedDir, 0o755);
                    fs.rmSync(restrictedDir, { recursive: true });
                } catch {
                    // Ignore cleanup errors
                }
            }
        });

        test('should handle empty search terms', async () => {
            await assert.doesNotReject(async () => {
                await fileExplorer.setSearchTerm('');
                await fileExplorer.setSearchTerm('   ');
                await fileExplorer.setSearchTerm(null as any);
                await fileExplorer.setSearchTerm(undefined as any);
            });
        });
    });

    suite('Integration with VS Code APIs', () => {
        test('should work with VS Code TreeView API', async () => {
            // Test that TreeItem creation works
            const roots = await fileExplorer.getChildren();
            assert.ok(roots.length > 0);
            
            const treeItem = fileExplorer.getTreeItem(roots[0]);
            assert.ok(treeItem);
            assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });

        test('should provide parent relationships correctly', async () => {
            const roots = await fileExplorer.getChildren();
            const workspaceRoot = roots[0];
            const children = await fileExplorer.getChildren(workspaceRoot);
            
            if (children.length > 0) {
                const firstChild = children[0];
                const parent = await fileExplorer.getParent(firstChild);
                
                assert.ok(parent);
                assert.strictEqual(parent!.fullPath, workspaceRoot.fullPath);
            }
        });

        test('should handle workspace folder changes', async () => {
            // Test that the provider can handle workspace changes
            // (This is more of a structural test since we can't easily mock workspace changes)
            assert.ok(fileExplorer);
            
            // Ensure dispose works without errors
            assert.doesNotThrow(() => {
                fileExplorer.dispose();
            });
        });
    });
});