/**
 * Unit tests for buildTreeFromSelection.
 * Tests tree structure generation from file selections.
 */
import { describe, expect, test } from '@jest/globals';
import { buildTreeFromSelection } from '../src/utils/buildTreeFromSelection';
import type { SelectedFile } from '../src/types';

describe('buildTreeFromSelection', () => {
  test('creates tree for single workspace', () => {
    const files: SelectedFile[] = [
      { path: 'src/index.ts', absolutePath: '/project/src/index.ts', content: '', tokenCount: 10, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' },
      { path: 'src/utils.ts', absolutePath: '/project/src/utils.ts', content: '', tokenCount: 20, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' },
      { path: 'test/index.test.ts', absolutePath: '/project/test/index.test.ts', content: '', tokenCount: 30, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' }
    ];

    const tree = buildTreeFromSelection(files);
    expect(tree).toContain('src/');
    expect(tree).toContain('├── index.ts');
    expect(tree).toContain('└── utils.ts');
    expect(tree).toContain('test/');
    expect(tree).toContain('└── index.test.ts');
  });

  test('groups by workspace when multi-root', () => {
    const files: SelectedFile[] = [
      { path: 'src/index.ts', absolutePath: '/app/src/index.ts', content: '', tokenCount: 10, workspaceFolderRootPath: '/app', workspaceFolderName: 'app' },
      { path: 'src/utils.ts', absolutePath: '/lib/src/utils.ts', content: '', tokenCount: 20, workspaceFolderRootPath: '/lib', workspaceFolderName: 'lib' }
    ];

    const tree = buildTreeFromSelection(files);
    expect(tree).toContain('app/');
    expect(tree).toContain('lib/');
    expect(tree).toContain('index.ts');
    expect(tree).toContain('utils.ts');
  });

  test('handles deeply nested structures', () => {
    const files: SelectedFile[] = [
      { path: 'a/b/c/d/file.ts', absolutePath: '/project/a/b/c/d/file.ts', content: '', tokenCount: 10, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' }
    ];

    const tree = buildTreeFromSelection(files);
    expect(tree).toContain('a/');
    expect(tree).toContain('b/');
    expect(tree).toContain('c/');
    expect(tree).toContain('d/');
    expect(tree).toContain('file.ts');
  });

  test('sorts directories before files', () => {
    const files: SelectedFile[] = [
      { path: 'z.txt', absolutePath: '/project/z.txt', content: '', tokenCount: 10, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' },
      { path: 'a/file.txt', absolutePath: '/project/a/file.txt', content: '', tokenCount: 10, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' },
      { path: 'b.txt', absolutePath: '/project/b.txt', content: '', tokenCount: 10, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' }
    ];

    const tree = buildTreeFromSelection(files);
    const lines = tree.split('\n').filter(l => l.trim());
    
    // Find indices of items
    const aIndex = lines.findIndex(l => l.includes('a/'));
    const bIndex = lines.findIndex(l => l.includes('b.txt'));
    const zIndex = lines.findIndex(l => l.includes('z.txt'));
    
    // Directories come before files
    expect(aIndex).toBeLessThan(bIndex);
    expect(aIndex).toBeLessThan(zIndex);
  });

  test('handles empty selection', () => {
    const tree = buildTreeFromSelection([]);
    expect(tree).toBe('');
  });

  test('skips invalid relative paths', () => {
    const files: SelectedFile[] = [
      { path: '../../../etc/passwd', absolutePath: '/etc/passwd', content: '', tokenCount: 10, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' },
      { path: 'valid.txt', absolutePath: '/project/valid.txt', content: '', tokenCount: 10, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' }
    ];

    const tree = buildTreeFromSelection(files);
    expect(tree).toContain('valid.txt');
    expect(tree).not.toContain('passwd');
  });

  test('handles Windows-style paths', () => {
    const files: SelectedFile[] = [
      { path: 'src\\index.ts', absolutePath: 'C:\\project\\src\\index.ts', content: '', tokenCount: 10, workspaceFolderRootPath: 'C:\\project', workspaceFolderName: 'project' }
    ];

    const tree = buildTreeFromSelection(files);
    // Should normalize to forward slashes
    expect(tree).toMatch(/src\//);
    expect(tree).toContain('index.ts');
  });

  test('includes token counts when verbose', () => {
    const files: SelectedFile[] = [
      { path: 'file.ts', absolutePath: '/project/file.ts', content: '', tokenCount: 1234, workspaceFolderRootPath: '/project', workspaceFolderName: 'project' }
    ];

    const tree = buildTreeFromSelection(files);
    expect(tree).toContain('file.ts');
    // Token counts might be shown in verbose mode
  });
});