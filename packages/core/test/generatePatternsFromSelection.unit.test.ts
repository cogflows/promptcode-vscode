import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generatePatternsFromSelection } from '../src/utils/generatePatternsFromSelection';
import type { SelectedFile } from '../src/types/selectedFile';

describe('generatePatternsFromSelection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'promptcode-patterns-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const createFile = (relativePath: string) => {
    const absolutePath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, '// test');
  };

  it('collapses to directory pattern when every descendant is selected', () => {
    createFile('src/utils/a.ts');
    createFile('src/utils/b.ts');

    const result = generatePatternsFromSelection(
      ['src/utils/a.ts', 'src/utils/b.ts'],
      tmpDir
    );

    expect(result).toContain('src/utils/**');
  });

  it('avoids wildcard patterns when sibling files are deselected', () => {
    createFile('src/utils/a.ts');
    createFile('src/utils/b.ts');
    createFile('src/utils/c.ts');

    const result = generatePatternsFromSelection(
      ['src/utils/a.ts', 'src/utils/b.ts'],
      tmpDir
    );

    expect(result).not.toContain('src/utils/**');
    expect(result).not.toContain('src/utils/*.ts');
    expect(result).toEqual(expect.arrayContaining(['src/utils/a.ts', 'src/utils/b.ts']));
  });

  it('uses extension wildcards when only that extension is fully selected', () => {
    createFile('src/components/Button.tsx');
    createFile('src/components/Input.tsx');
    createFile('src/components/config.json');

    const result = generatePatternsFromSelection(
      ['src/components/Button.tsx', 'src/components/Input.tsx'],
      tmpDir
    );

    expect(result).not.toContain('src/components/**');
    expect(result).toContain('src/components/*.tsx');
    expect(result).not.toContain('src/components/config.json');
  });

  it('removes redundant nested directory globs when parent directory is fully covered', () => {
    createFile('src/index.ts');
    createFile('src/utils/a.ts');
    createFile('src/utils/b.ts');
    createFile('src/utils/deep/ignored.ts');

    const result = generatePatternsFromSelection(
      ['src/index.ts', 'src/utils/a.ts', 'src/utils/b.ts'],
      tmpDir
    );

    expect(result).toContain('src/*.ts');
    expect(result).not.toContain('src/**');
    expect(result).not.toContain('src/utils/**');
  });

  it('keeps deselected sub-directories excluded when saving preset', () => {
    createFile('ingestion/index.ts');
    createFile('ingestion/data/ignored.ts');
    createFile('ingestion/src/index.ts');
    createFile('ingestion/src/utils.ts');
    createFile('ingestion/src/data/ignored.ts');

    const result = generatePatternsFromSelection(
      ['ingestion/index.ts', 'ingestion/src/index.ts', 'ingestion/src/utils.ts'],
      tmpDir
    );

    expect(result).not.toContain('ingestion/**');
    expect(result).not.toContain('ingestion/src/**');
    expect(result).not.toContain('ingestion/data/**');
    expect(result).not.toContain('ingestion/src/data/**');
  });

  it('deduplicates duplicate file selections', () => {
    createFile('src/utils/a.ts');

    const result = generatePatternsFromSelection(
      ['src/utils/a.ts', 'src/utils/a.ts'],
      tmpDir
    );

    expect(new Set(result).size).toBe(result.length);
    expect(result.length).toBe(1);
  });

  it('treats selections case-insensitively on Windows', () => {
    if (process.platform !== 'win32') {
      // Skip on non-Windows systems where the filesystem may be case-sensitive.
      return;
    }

    createFile('src/components/Button.tsx');
    createFile('src/components/Input.tsx');

    const result = generatePatternsFromSelection(
      ['SRC/COMPONENTS/BUTTON.TSX', 'src/components/input.tsx'],
      tmpDir
    );

    expect(result.some(p => p.toLowerCase() === 'src/components/*.tsx')).toBeTruthy();
  });

  it('falls back to explicit files when a symlink escapes the workspace', () => {
    if (process.platform === 'win32') {
      // Creating symlinks on Windows requires elevated privileges; skip to avoid flakiness.
      return;
    }

    const outsideTarget = path.join(tmpDir, '..', `outside-file-${Date.now()}.txt`);
    fs.writeFileSync(outsideTarget, '// outside');

    const symlinkDir = path.join(tmpDir, 'src');
    fs.mkdirSync(symlinkDir, { recursive: true });
    const linkPath = path.join(symlinkDir, 'link.txt');
    fs.symlinkSync(outsideTarget, linkPath);

    try {
      const result = generatePatternsFromSelection(
        ['src/link.txt'],
        tmpDir
      );

      expect(result).toEqual(['src/link.txt']);
    } finally {
      fs.unlinkSync(outsideTarget);
    }
  });

  it('infers workspace root from SelectedFile entries', () => {
    createFile('src/components/Button.tsx');
    createFile('src/components/Input.tsx');

    const selected: SelectedFile[] = [
      {
        path: 'src/components/Button.tsx',
        absolutePath: path.join(tmpDir, 'src/components/Button.tsx'),
        content: '',
        workspaceFolderRootPath: tmpDir,
        workspaceFolderName: 'tmp',
        tokenCount: 0
      },
      {
        path: 'src/components/Input.tsx',
        absolutePath: path.join(tmpDir, 'src/components/Input.tsx'),
        content: '',
        workspaceFolderRootPath: tmpDir,
        workspaceFolderName: 'tmp',
        tokenCount: 0
      }
    ];

    const result = generatePatternsFromSelection(selected);

    expect(result).toContain('src/components/*.tsx');
  });

  it('falls back to explicit files when workspace root is unavailable', () => {
    createFile('src/utils/a.ts');
    createFile('src/utils/b.ts');

    const result = generatePatternsFromSelection(['src/utils/a.ts', 'src/utils/b.ts']);

    expect(result).toEqual(expect.arrayContaining(['src/utils/a.ts', 'src/utils/b.ts']));
    expect(result).not.toContain('src/utils/**');
  });
});
