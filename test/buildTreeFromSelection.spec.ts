import { buildTreeFromSelection } from '../src/utils/buildTreeFromSelection';
import type { SelectedFile } from '../src/types/selectedFile';
import { describe, it, expect } from 'vitest'; // Assuming vitest based on guidance

describe('buildTreeFromSelection', () => {
  it('prints minimal tree for single root', () => {
    const mockSelected: SelectedFile[] = [
      { path: 'src/extension.ts', workspaceFolderRootPath: '/repo', absolutePath: '/repo/src/extension.ts', tokenCount: 0, workspaceFolderName: 'repo' },
      { path: 'src/promptGenerator.ts', workspaceFolderRootPath: '/repo', absolutePath: '/repo/src/promptGenerator.ts', tokenCount: 0, workspaceFolderName: 'repo' },
      { path: 'test/prompt.spec.ts', workspaceFolderRootPath: '/repo', absolutePath: '/repo/test/prompt.spec.ts', tokenCount: 0, workspaceFolderName: 'repo' },
    ];
    const expectedOutput = 
`repo/
` +
`├── src/
` +
`│   ├── extension.ts
` +
`│   └── promptGenerator.ts
` +
`└── test/
` +
`    └── prompt.spec.ts`;

    const out = buildTreeFromSelection(mockSelected);
    // Trim trailing whitespace/newlines for robust comparison
    expect(out.trim()).toBe(expectedOutput.trim()); 
  });

  it('handles files in root directory', () => {
    const mockSelected: SelectedFile[] = [
      { path: 'README.md', workspaceFolderRootPath: '/repo', absolutePath: '/repo/README.md', tokenCount: 0, workspaceFolderName: 'repo' },
      { path: 'src/extension.ts', workspaceFolderRootPath: '/repo', absolutePath: '/repo/src/extension.ts', tokenCount: 0, workspaceFolderName: 'repo' },
    ];
    const expectedOutput = 
`repo/
` +
`├── README.md
` +
`└── src/
` +
`    └── extension.ts`;

    const out = buildTreeFromSelection(mockSelected);
    expect(out.trim()).toBe(expectedOutput.trim());
  });

  it('handles multiple workspace roots', () => {
    const mockSelected: SelectedFile[] = [
      { path: 'main.py', workspaceFolderRootPath: '/projectA', absolutePath: '/projectA/main.py', tokenCount: 0, workspaceFolderName: 'projectA' },
      { path: 'utils/helpers.ts', workspaceFolderRootPath: '/projectB/lib', absolutePath: '/projectB/lib/utils/helpers.ts', tokenCount: 0, workspaceFolderName: 'lib' }, // Note: workspaceFolderName might differ from last part of root path
      { path: 'config.json', workspaceFolderRootPath: '/projectA', absolutePath: '/projectA/config.json', tokenCount: 0, workspaceFolderName: 'projectA' },
    ];
    const expectedOutput = 
`projectA/
` +
`├── config.json
` +
`└── main.py
` +
`lib/
` +
`└── utils/
` +
`    └── helpers.ts`;

    const out = buildTreeFromSelection(mockSelected);
    expect(out.trim()).toBe(expectedOutput.trim());
  });

  it('correctly handles Windows-style paths as input', () => {
    const mockSelected: SelectedFile[] = [
      { path: 'src\\extension.ts', workspaceFolderRootPath: 'C:\\repo', absolutePath: 'C:\\repo\\src\\extension.ts', tokenCount: 0, workspaceFolderName: 'repo' },
      { path: 'test\\prompt.spec.ts', workspaceFolderRootPath: 'C:\\repo', absolutePath: 'C:\\repo\\test\\prompt.spec.ts', tokenCount: 0, workspaceFolderName: 'repo' },
    ];
    const expectedOutput = 
`repo/
` +
`├── src/
` +
`│   └── extension.ts
` +
`└── test/
` +
`    └── prompt.spec.ts`;
    
    const out = buildTreeFromSelection(mockSelected);
    expect(out.trim()).toBe(expectedOutput.trim());
  });

  it('returns empty string for no selection', () => {
    const mockSelected: SelectedFile[] = [];
    const expectedOutput = '';
    const out = buildTreeFromSelection(mockSelected);
    expect(out).toBe(expectedOutput);
  });
  
  it('sorts directories before files alphabetically', () => {
    const mockSelected: SelectedFile[] = [
      { path: 'b.txt', workspaceFolderRootPath: '/repo', absolutePath: '/repo/b.txt', tokenCount: 0, workspaceFolderName: 'repo' }, 
      { path: 'a_dir/a.txt', workspaceFolderRootPath: '/repo', absolutePath: '/repo/a_dir/a.txt', tokenCount: 0, workspaceFolderName: 'repo' },
      { path: 'c.txt', workspaceFolderRootPath: '/repo', absolutePath: '/repo/c.txt', tokenCount: 0, workspaceFolderName: 'repo' },
      { path: 'z_dir/z.txt', workspaceFolderRootPath: '/repo', absolutePath: '/repo/z_dir/z.txt', tokenCount: 0, workspaceFolderName: 'repo' },
    ];
    const expectedOutput = 
`repo/
` +
`├── a_dir/
` +
`│   └── a.txt
` +
`├── z_dir/
` +
`│   └── z.txt
` +
`├── b.txt
` +
`└── c.txt`;
    
    const out = buildTreeFromSelection(mockSelected);
    expect(out.trim()).toBe(expectedOutput.trim());
  });
}); 