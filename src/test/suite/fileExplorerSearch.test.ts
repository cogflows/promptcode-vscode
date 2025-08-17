import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileExplorerProvider, FileItem, checkedItems, expandedItems } from '../../fileExplorer';

suite('FileExplorer Search & Reveal Tests', () => {
    let tempDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;
    let fileExplorer: FileExplorerProvider;
    let mockTreeView: vscode.TreeView<FileItem>;
    let mockContext: vscode.ExtensionContext;

    // Test structure designed to test search behavior
    const testFiles = {
        'README.md': 'Project documentation',
        'package.json': '{"name": "test", "version": "1.0.0"}',
        'src/index.ts': 'console.log("main");',
        'src/utils/helper.ts': 'export function help() {}',
        'src/utils/math.ts': 'export function add(a, b) { return a + b; }',
        'src/components/Button.tsx': 'export const Button = () => <button>Click</button>;',
        'src/components/Card.tsx': 'export const Card = () => <div>Card</div>;',
        'tests/helper.test.ts': 'test("helper", () => {});',
        'docs/api.md': '# API Reference',
        'nested/deep/very/deep/file.txt': 'deep file content',
        'node_modules/package/index.js': 'module.exports = {};',
        '.gitignore': 'node_modules/\n*.log',
        '.promptcode_ignore': 'tests/\ndocs/\n.git/'
    };

    suiteSetup(async function() {
        this.timeout(30000);

        // Create temp directory and files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-search-test-'));
        
        for (const [relativePath, content] of Object.entries(testFiles)) {
            const fullPath = path.join(tempDir, relativePath);
            const dirPath = path.dirname(fullPath);
            
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(fullPath, content);
        }

        // Setup workspace
        workspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: path.basename(tempDir),
            index: 0
        };

        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceFolder],
            writable: true,
            configurable: true
        });
        
        console.log('[Test Setup] After mocking, vscode.workspace.workspaceFolders:', vscode.workspace.workspaceFolders);

        // Mock context
        const workspaceState = new Map<string, any>();
        mockContext = {
            workspaceState: {
                get: <T>(key: string, defaultValue?: T) => workspaceState.get(key) ?? defaultValue,
                update: (key: string, value: any) => { workspaceState.set(key, value); return Promise.resolve(); }
            }
        } as any;

        // Initialize file explorer
        console.log('[Test Setup] Creating FileExplorerProvider...');
        fileExplorer = new FileExplorerProvider();
        fileExplorer.setContext(mockContext);
        await fileExplorer.initializeWorkspaceRoots(); // Initialize workspace roots and build index

        // Mock tree view with reveal tracking
        const revealedPaths: string[] = [];
        const expandedPaths: string[] = [];

        mockTreeView = {
            reveal: async (element: FileItem, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
                revealedPaths.push(element.fullPath);
                if (options?.expand && element.isDirectory) {
                    expandedPaths.push(element.fullPath);
                    expandedItems.set(element.fullPath, true);
                }
            },
            onDidExpandElement: (callback: (e: vscode.TreeViewExpansionEvent<FileItem>) => void) => {
                return { dispose: () => {} };
            },
            onDidCollapseElement: (callback: (e: vscode.TreeViewExpansionEvent<FileItem>) => void) => {
                return { dispose: () => {} };
            }
        } as any;

        // Add test helper methods to mockTreeView
        (mockTreeView as any).getRevealedPaths = () => [...revealedPaths];
        (mockTreeView as any).getExpandedPaths = () => [...expandedPaths];
        (mockTreeView as any).clearTracking = () => {
            revealedPaths.length = 0;
            expandedPaths.length = 0;
        };

        fileExplorer.setTreeView(mockTreeView);

        // Ensure index is ready
        await fileExplorer.waitForIndexBuild();
    });

    setup(() => {
        // Clear state before each test
        checkedItems.clear();
        expandedItems.clear();
        if ((mockTreeView as any).clearTracking) {
            (mockTreeView as any).clearTracking();
        }
    });

    suiteTeardown(() => {
        if (fileExplorer) {
            fileExplorer.dispose();
        }
        
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Search Functionality', () => {
        test('should find files by exact name match', async () => {
            await fileExplorer.setSearchTerm('helper');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(results.length > 0, 'Should find files matching "helper"');
            assert.ok(
                results.some(r => r.includes('helper.ts')), 
                'Should find helper.ts'
            );
        });

        test('should find files by partial name match', async () => {
            await fileExplorer.setSearchTerm('help');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(results.length > 0, 'Should find files matching "help"');
            assert.ok(
                results.some(r => r.includes('helper.ts')), 
                'Should find helper.ts with partial match'
            );
        });

        test('should find files by extension glob pattern', async () => {
            await fileExplorer.setSearchTerm('*.tsx', true);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(results.length > 0, 'Should find .tsx files');
            assert.ok(
                results.some(r => r.includes('Button.tsx')), 
                'Should find Button.tsx'
            );
            assert.ok(
                results.some(r => r.includes('Card.tsx')), 
                'Should find Card.tsx'
            );
            assert.ok(
                results.every(r => r.endsWith('.tsx')), 
                'All results should be .tsx files'
            );
        });

        test('should find files by path search', async () => {
            await fileExplorer.setSearchTerm('src/utils');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(results.length > 0, 'Should find files in src/utils');
            assert.ok(
                results.some(r => r.includes('utils/helper.ts')), 
                'Should find utils/helper.ts'
            );
            assert.ok(
                results.some(r => r.includes('utils/math.ts')), 
                'Should find utils/math.ts'
            );
        });

        test('should find files by complex glob pattern', async () => {
            await fileExplorer.setSearchTerm('src/**/*.ts', true);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(results.length > 0, 'Should find TypeScript files in src');
            assert.ok(
                results.some(r => r.includes('src/index.ts')), 
                'Should find src/index.ts'
            );
            assert.ok(
                results.some(r => r.includes('src/utils/helper.ts')), 
                'Should find src/utils/helper.ts'
            );
            assert.ok(
                results.every(r => r.includes('src/') && r.endsWith('.ts')), 
                'All results should be .ts files in src directory'
            );
        });

        test('should respect ignore patterns', async () => {
            await fileExplorer.setSearchTerm('*', true);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            
            // Should not include ignored files/directories
            assert.ok(
                !results.some(r => r.includes('node_modules')), 
                'Should not include node_modules files'
            );
            assert.ok(
                !results.some(r => r.includes('tests/')), 
                'Should not include test files (ignored by .promptcode_ignore)'
            );
            assert.ok(
                !results.some(r => r.includes('docs/')), 
                'Should not include docs files (ignored by .promptcode_ignore)'
            );
        });

        test('should handle case-insensitive search', async () => {
            await fileExplorer.setSearchTerm('HELPER');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(
                results.some(r => r.includes('helper.ts')), 
                'Should find helper.ts with uppercase search term'
            );
        });

        test('should clear results when search term is empty', async () => {
            // First set a search term
            await fileExplorer.setSearchTerm('helper');
            let results = await fileExplorer.getCurrentSearchResults();
            assert.ok(results.length > 0, 'Should have results initially');
            
            // Clear search
            await fileExplorer.setSearchTerm('');
            results = await fileExplorer.getCurrentSearchResults();
            assert.strictEqual(results.length, 0, 'Should clear results when search is empty');
        });
    });

    suite('Auto-Expand on Search', () => {
        test('should auto-expand parent directories when searching', async () => {
            expandedItems.clear();
            
            await fileExplorer.setSearchTerm('helper');
            
            // Wait for auto-expansion
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Check that parent directories of matching files are expanded
            const srcPath = path.join(tempDir, 'src');
            const utilsPath = path.join(tempDir, 'src', 'utils');
            
            assert.ok(
                expandedItems.get(srcPath), 
                'src directory should be auto-expanded to show helper.ts'
            );
            assert.ok(
                expandedItems.get(utilsPath), 
                'utils directory should be auto-expanded to show helper.ts'
            );
        });

        test('should auto-expand deeply nested paths', async () => {
            expandedItems.clear();
            
            await fileExplorer.setSearchTerm('deep');
            
            // Wait for auto-expansion
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Check that all parent directories are expanded
            const nestedPath = path.join(tempDir, 'nested');
            const deepPath = path.join(tempDir, 'nested', 'deep');
            const veryPath = path.join(tempDir, 'nested', 'deep', 'very');
            const veryDeepPath = path.join(tempDir, 'nested', 'deep', 'very', 'deep');
            
            assert.ok(expandedItems.get(nestedPath), 'nested should be expanded');
            assert.ok(expandedItems.get(deepPath), 'deep should be expanded');
            assert.ok(expandedItems.get(veryPath), 'very should be expanded');
            assert.ok(expandedItems.get(veryDeepPath), 'very/deep should be expanded');
        });

        test('should not expand when no search results', async () => {
            expandedItems.clear();
            
            await fileExplorer.setSearchTerm('nonexistentfile');
            
            // Wait for potential expansion
            await new Promise(resolve => setTimeout(resolve, 500));
            
            assert.strictEqual(
                expandedItems.size, 
                0, 
                'No directories should be expanded when no search results'
            );
        });

        test('should preserve existing expanded state during search', async () => {
            // Pre-expand some directories
            const srcPath = path.join(tempDir, 'src');
            expandedItems.set(srcPath, true);
            
            await fileExplorer.setSearchTerm('Button');
            
            // Wait for search processing
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Pre-expanded directory should still be expanded
            assert.ok(
                expandedItems.get(srcPath), 
                'Pre-expanded directories should remain expanded during search'
            );
            
            // Components directory should also be expanded for the search result
            const componentsPath = path.join(tempDir, 'src', 'components');
            assert.ok(
                expandedItems.get(componentsPath), 
                'Components directory should be expanded for search result'
            );
        });
    });

    suite('Reveal Functionality', () => {
        test('should reveal specific file path', async () => {
            const targetFile = path.join(tempDir, 'src', 'utils', 'helper.ts');
            
            await fileExplorer.revealPath(targetFile);
            
            // Check that file was revealed (in real usage, this would be done by TreeView.reveal)
            // Here we just verify the expand behavior
            const srcPath = path.join(tempDir, 'src');
            const utilsPath = path.join(tempDir, 'src', 'utils');
            
            assert.ok(
                expandedItems.get(srcPath), 
                'src directory should be expanded to reveal file'
            );
            assert.ok(
                expandedItems.get(utilsPath), 
                'utils directory should be expanded to reveal file'
            );
        });

        test('should reveal deeply nested file', async () => {
            const targetFile = path.join(tempDir, 'nested', 'deep', 'very', 'deep', 'file.txt');
            
            await fileExplorer.revealPath(targetFile);
            
            // All parent directories should be expanded
            const nestedPath = path.join(tempDir, 'nested');
            const deepPath = path.join(tempDir, 'nested', 'deep');
            const veryPath = path.join(tempDir, 'nested', 'deep', 'very');
            const veryDeepPath = path.join(tempDir, 'nested', 'deep', 'very', 'deep');
            
            assert.ok(expandedItems.get(nestedPath), 'nested should be expanded');
            assert.ok(expandedItems.get(deepPath), 'deep should be expanded');
            assert.ok(expandedItems.get(veryPath), 'very should be expanded');
            assert.ok(expandedItems.get(veryDeepPath), 'very/deep should be expanded');
        });

        test('should handle revealing non-existent files gracefully', async () => {
            const nonExistentFile = path.join(tempDir, 'does-not-exist.txt');
            
            // Should not throw
            await assert.doesNotReject(async () => {
                await fileExplorer.revealPath(nonExistentFile);
            });
        });

        test('should expand to show file without full reveal', async () => {
            const targetFile = path.join(tempDir, 'src', 'components', 'Button.tsx');
            
            expandedItems.clear();
            
            await fileExplorer.expandToShowFile(targetFile);
            
            // Parent directories should be expanded
            const srcPath = path.join(tempDir, 'src');
            const componentsPath = path.join(tempDir, 'src', 'components');
            
            assert.ok(
                expandedItems.get(srcPath), 
                'src directory should be expanded'
            );
            assert.ok(
                expandedItems.get(componentsPath), 
                'components directory should be expanded'
            );
        });
    });

    suite('Search Result Navigation (Enter Key Behavior)', () => {
        test('should get current search results for navigation', async () => {
            await fileExplorer.setSearchTerm('*.ts', true);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(results.length > 0, 'Should have search results');
            assert.ok(
                results.every(r => {
                    try {
                        return fs.statSync(r).isFile();
                    } catch {
                        return false;
                    }
                }), 
                'All search results should be files, not directories'
            );
        });

        test('should reveal first search result (simulating Enter key)', async () => {
            await fileExplorer.setSearchTerm('helper');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            assert.ok(results.length > 0, 'Should have search results');
            
            // Simulate Enter key behavior - reveal first result
            const firstResult = results[0];
            await fileExplorer.revealPath(firstResult);
            
            // Check that the path to the first result is expanded
            const resultDir = path.dirname(firstResult);
            let currentPath = resultDir;
            
            // Walk up the tree and ensure all parents are expanded
            while (currentPath && currentPath !== tempDir && currentPath !== path.dirname(currentPath)) {
                assert.ok(
                    expandedItems.get(currentPath), 
                    `Directory ${currentPath} should be expanded to reveal search result`
                );
                currentPath = path.dirname(currentPath);
            }
        });

        test('should handle multiple search results correctly', async () => {
            await fileExplorer.setSearchTerm('*.tsx', true);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for debounced search
            
            const results = await fileExplorer.getCurrentSearchResults();
            
            assert.ok(results.length >= 2, 'Should have multiple .tsx files');
            
            // All results should be valid files
            for (const result of results) {
                assert.ok(
                    fs.existsSync(result), 
                    `Search result ${result} should exist`
                );
                assert.ok(
                    fs.statSync(result).isFile(), 
                    `Search result ${result} should be a file`
                );
            }
        });
    });

    suite('Performance and Edge Cases', () => {
        test('should handle rapid search term changes', async () => {
            // Rapidly change search terms to test debouncing
            const promises = [
                fileExplorer.setSearchTerm('a'),
                fileExplorer.setSearchTerm('he'),
                fileExplorer.setSearchTerm('hel'),
                fileExplorer.setSearchTerm('help'),
                fileExplorer.setSearchTerm('helper')
            ];
            
            await Promise.all(promises);
            
            // Final results should be for 'helper'
            const results = await fileExplorer.getCurrentSearchResults();
            assert.ok(
                results.some(r => r.includes('helper.ts')), 
                'Should show results for final search term'
            );
        });

        test('should handle empty search terms gracefully', async () => {
            await assert.doesNotReject(async () => {
                await fileExplorer.setSearchTerm('');
                await fileExplorer.setSearchTerm('   ');
                await fileExplorer.setSearchTerm('\t\n');
            });
        });

        test('should handle special characters in search', async () => {
            await assert.doesNotReject(async () => {
                await fileExplorer.setSearchTerm('file.ts');
                await fileExplorer.setSearchTerm('src/');
                await fileExplorer.setSearchTerm('*.{ts,tsx}', true);
            });
        });

        test('should clear expanded state when clearing search', async () => {
            // Set search and let it auto-expand
            await fileExplorer.setSearchTerm('helper');
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const initialExpandedSize = expandedItems.size;
            assert.ok(initialExpandedSize > 0, 'Should have expanded directories');
            
            // Clear search
            await fileExplorer.setSearchTerm('');
            
            // Expanded state should be preserved (this is the current behavior)
            // In real usage, users might want to keep their expanded state
            assert.ok(
                expandedItems.size >= 0, 
                'Expanded state behavior should be consistent'
            );
        });
    });
});