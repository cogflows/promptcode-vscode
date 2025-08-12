import * as assert from 'assert';
import { buildPrompt, buildTreeFromSelection, generatePatternsFromSelection, countTokens } from '@promptcode/core';
import type { SelectedFile } from '@promptcode/core';

suite('Core Migration Test', () => {
    test('buildPrompt should generate correct output with tag compatibility', async () => {
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

        // Verify the prompt contains expected tags
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
        const selectedFiles: SelectedFile[] = [
            {
                path: 'src/components/Button.tsx',
                absolutePath: '/test/src/components/Button.tsx',
                content: '',
                workspaceFolderRootPath: '/test',
                workspaceFolderName: 'test',
                tokenCount: 0
            },
            {
                path: 'src/components/Input.tsx',
                absolutePath: '/test/src/components/Input.tsx',
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
            }
        ];

        const patterns = generatePatternsFromSelection(selectedFiles);
        
        // Should consolidate to pattern
        assert.ok(patterns.includes('src/components/*.tsx'));
        assert.ok(patterns.includes('src/utils/helper.ts'));
    });

    test('countTokens should return consistent results', () => {
        const text = 'This is a test string for counting tokens in the VS Code extension.';
        const tokens = countTokens(text);
        
        // Verify token count is reasonable
        assert.ok(tokens > 0);
        assert.ok(tokens < 100); // Should be much less than 100 for this short string
    });

    test('Tag compatibility layer should transform old tags to new ones', () => {
        // This tests the tag transformation that happens in extension.ts
        const oldPrompt = '<instructions>Test</instructions><file_map>tree</file_map><file_contents>content</file_contents>';
        
        // Simulate the tag transformation logic from extension.ts
        const TAG_MAP = {
            'instructions': 'user_instructions',
            '/instructions': '/user_instructions',
            'file_map': 'file_tree',
            '/file_map': '/file_tree',
            'file_contents': 'files',
            '/file_contents': '/files'
        } as const;
        
        const newPrompt = oldPrompt.replace(/<(\/?)(instructions|file_map|file_contents)>/g, (match, slash, tag) => {
            const key = `${slash}${tag}` as keyof typeof TAG_MAP;
            return TAG_MAP[key] ? `<${TAG_MAP[key]}>` : match;
        });
        
        assert.strictEqual(newPrompt, '<user_instructions>Test</user_instructions><file_tree>tree</file_tree><files>content</files>');
    });
});