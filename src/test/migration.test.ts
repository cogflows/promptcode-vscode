import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildPrompt, buildTreeFromSelection, generatePatternsFromSelection, countTokens } from '@promptcode/core';
import type { SelectedFile } from '@promptcode/core';

suite('Core Migration Test', () => {
    test('buildPrompt should generate correct output with standard tags', async () => {
        const selectedFiles: SelectedFile[] = [
            {
                path: 'file1.ts',
                absolutePath: '/test/file1.ts',
                content: 'const hello = "world";',
                workspaceFolderRootPath: '/test',
                workspaceFolderName: 'test',
                tokenCount: 10
            },
            {
                path: 'dir/file2.ts',
                absolutePath: '/test/dir/file2.ts',
                content: 'export function test() { return true; }',
                workspaceFolderRootPath: '/test',
                workspaceFolderName: 'test',
                tokenCount: 15
            }
        ];

        const result = await buildPrompt(selectedFiles, 'Test instructions', {
            includeFiles: true,
            includeInstructions: true,
            includeFileContents: true
        });

        const prompt = result.prompt;

        // Verify the prompt contains expected standard tags
        assert.ok(prompt.includes('<user_instructions>'));
        assert.ok(prompt.includes('Test instructions'));
        assert.ok(prompt.includes('</user_instructions>'));
        assert.ok(prompt.includes('<file_tree>'));
        assert.ok(prompt.includes('</file_tree>'));
        assert.ok(prompt.includes('<files>'));
        assert.ok(prompt.includes('file1.ts'));
        assert.ok(prompt.includes('file2.ts'));
        assert.ok(prompt.includes('const hello = "world";'));
        assert.ok(prompt.includes('export function test() { return true; }'));
        assert.ok(prompt.includes('</files>'));
    });

    test('buildTreeFromSelection should generate correct tree structure', () => {
        const selectedFiles: SelectedFile[] = [
            {
                path: 'src/index.ts',
                absolutePath: '/test/src/index.ts',
                content: '',
                workspaceFolderRootPath: '/test',
                workspaceFolderName: 'test',
                tokenCount: 0
            },
            {
                path: 'src/utils/helper.ts',
                absolutePath: '/test/src/utils/helper.ts',
                content: '',
                workspaceFolderRootPath: '/test',
                workspaceFolderName: 'test',
                tokenCount: 0
            },
            {
                path: 'README.md',
                absolutePath: '/test/README.md',
                content: '',
                workspaceFolderRootPath: '/test',
                workspaceFolderName: 'test',
                tokenCount: 0
            }
        ];

        const tree = buildTreeFromSelection(selectedFiles);
        
        // Verify tree structure
        assert.ok(tree.includes('src/'));
        assert.ok(tree.includes('index.ts'));
        assert.ok(tree.includes('utils/'));
        assert.ok(tree.includes('helper.ts'));
        assert.ok(tree.includes('README.md'));
    });

    test('generatePatternsFromSelection should create correct patterns', () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-migration-'));
        const ensureFile = (relativePath: string) => {
            const absolute = path.join(workspaceRoot, relativePath);
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, '// test');
        };

        ensureFile('src/components/Button.tsx');
        ensureFile('src/components/Input.tsx');
        ensureFile('src/utils/helper.ts');

        const selectedFiles: SelectedFile[] = [
            {
                path: 'src/components/Button.tsx',
                absolutePath: path.join(workspaceRoot, 'src/components/Button.tsx'),
                content: '',
                workspaceFolderRootPath: workspaceRoot,
                workspaceFolderName: path.basename(workspaceRoot),
                tokenCount: 0
            },
            {
                path: 'src/components/Input.tsx',
                absolutePath: path.join(workspaceRoot, 'src/components/Input.tsx'),
                content: '',
                workspaceFolderRootPath: workspaceRoot,
                workspaceFolderName: path.basename(workspaceRoot),
                tokenCount: 0
            },
            {
                path: 'src/utils/helper.ts',
                absolutePath: path.join(workspaceRoot, 'src/utils/helper.ts'),
                content: '',
                workspaceFolderRootPath: workspaceRoot,
                workspaceFolderName: path.basename(workspaceRoot),
                tokenCount: 0
            }
        ];

        try {
            const patterns = generatePatternsFromSelection(selectedFiles);
        
            // Should consolidate to pattern
            assert.ok(patterns.includes('src/components/*.tsx'));
            assert.ok(patterns.includes('src/utils/helper.ts') || patterns.includes('src/utils/*.ts'));
        } finally {
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });

    test('countTokens should return consistent results', () => {
        const text = 'This is a test string for counting tokens in the VS Code extension.';
        const tokens = countTokens(text);
        
        // Verify token count is reasonable
        assert.ok(tokens > 0);
        assert.ok(tokens < 100); // Should be much less than 100 for this short string
    });

});
