import * as fs from 'fs';
import * as path from 'path';
import type { SelectedFile } from '../types/selectedFile.js';

interface DirectoryScan {
  allFiles: string[];
  directFilesByExtension: Map<string, string[]>;
  directCoverageByExtension: Map<string, boolean>;
  fullySelected: boolean;
}

/**
 * Generate compact Git-style patterns from a file selection.
 * Supports both string[] and SelectedFile[] for backward compatibility.
 * @param selection Array of selected file paths or SelectedFile objects
 * @param workspaceRoot Optional workspace root (required for directory verification)
 * @returns Array of patterns that represent the selection
 */
export function generatePatternsFromSelection(
  selection: string[] | SelectedFile[],
  workspaceRoot?: string
): string[] {
  if (!selection || selection.length === 0) {
    return [];
  }

  const isSelectedFileArray = typeof selection[0] === 'object' && 'path' in (selection[0] as SelectedFile);

  let effectiveRoot = workspaceRoot;
  if (!effectiveRoot && isSelectedFileArray) {
    const roots = new Set(
      (selection as SelectedFile[])
        .map(item => item.workspaceFolderRootPath)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    );

    if (roots.size === 1) {
      effectiveRoot = path.resolve(Array.from(roots)[0]!);
    }
  }

  const selectedPaths = (selection as Array<string | SelectedFile>).map(item =>
    typeof item === 'string' ? item : (item as SelectedFile).path
  );

  if (selectedPaths.length === 0) {
    return [];
  }

  const posixPaths = selectedPaths.map(toPosixPath).sort();
  const normalizedRoot = effectiveRoot ? path.resolve(effectiveRoot) : undefined;
  const useCaseInsensitiveComparison = shouldUseCaseInsensitiveComparison(normalizedRoot);
  const normalizeForComparison = (value: string) => (useCaseInsensitiveComparison ? value.toLowerCase() : value);

  const selectedSet = new Set(posixPaths.map(normalizeForComparison));
  const coveredNormalized = new Set<string>();
  const directoryScanCache = new Map<string, DirectoryScan | null>();

  const dirGroups = new Map<string, { files: string[]; extensions: Set<string> }>();
  for (const file of posixPaths) {
    const dir = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '.';
    const ext = file.includes('.') ? file.substring(file.lastIndexOf('.')) : '';

    if (!dirGroups.has(dir)) {
      dirGroups.set(dir, { files: [], extensions: new Set() });
    }
    const group = dirGroups.get(dir)!;
    group.files.push(file);
    if (ext) {
      group.extensions.add(ext);
    }
  }

  const patterns: string[] = [];

  const isSelected = (value: string): boolean => selectedSet.has(normalizeForComparison(value));

  const markCovered = (paths: string[]) => {
    for (const filePath of paths) {
      if (isSelected(filePath)) {
        coveredNormalized.add(normalizeForComparison(filePath));
      }
    }
  };

  const getDirectoryScan = (dir: string): DirectoryScan | null => {
    if (!normalizedRoot || dir === '.') {
      return null;
    }

    if (directoryScanCache.has(dir)) {
      return directoryScanCache.get(dir)!;
    }

    const fsRelative = dir.split('/').join(path.sep);
    const absoluteDir = path.resolve(normalizedRoot, fsRelative);

    try {
      const stat = fs.statSync(absoluteDir);
      if (!stat.isDirectory()) {
        directoryScanCache.set(dir, null);
        return null;
      }
    } catch {
      directoryScanCache.set(dir, null);
      return null;
    }

    const visited = new Set<string>();
    const allFiles: string[] = [];
    const directFilesByExtension = new Map<string, string[]>();
    const directCoverageByExtension = new Map<string, boolean>();
    let fullySelected = true;

    const stack: string[] = [absoluteDir];

    while (stack.length > 0) {
      const currentAbs = stack.pop()!;
      let realCurrent: string;

      try {
        realCurrent = fs.realpathSync(currentAbs);
      } catch {
        directoryScanCache.set(dir, null);
        return null;
      }

      if (visited.has(realCurrent)) {
        continue;
      }
      visited.add(realCurrent);

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentAbs, { withFileTypes: true });
      } catch {
        directoryScanCache.set(dir, null);
        return null;
      }

      for (const entry of entries) {
        if (entry.name === '.' || entry.name === '..') {
          continue;
        }

        const childAbs = path.join(currentAbs, entry.name);
        let isDirectory = entry.isDirectory();
        let isFile = entry.isFile();

        let resolvedChild = childAbs;

        if (entry.isSymbolicLink()) {
          try {
            resolvedChild = fs.realpathSync(childAbs);
          } catch {
            directoryScanCache.set(dir, null);
            return null;
          }
          const targetStats = fs.statSync(childAbs);
          isDirectory = targetStats.isDirectory();
          isFile = targetStats.isFile();
        }

        if (!isPathInside(normalizedRoot, resolvedChild)) {
          directoryScanCache.set(dir, null);
          return null;
        }

        const relativeRaw = path.relative(normalizedRoot, childAbs);
        if (relativeRaw.startsWith('..') || path.isAbsolute(relativeRaw)) {
          directoryScanCache.set(dir, null);
          return null;
        }
        const relative = toPosixPath(relativeRaw);

        if (isDirectory) {
          stack.push(childAbs);
          continue;
        }

        if (!isFile) {
          // Unsupported entry type (e.g., socket, device). Abort generalisation.
          directoryScanCache.set(dir, null);
          return null;
        }

        allFiles.push(relative);

        if (!isSelected(relative)) {
          fullySelected = false;
        }

        const parentDir = relative.includes('/') ? relative.substring(0, relative.lastIndexOf('/')) : '.';
        if (parentDir === dir) {
          const ext = relative.includes('.') ? relative.substring(relative.lastIndexOf('.')) : '';
          if (!directFilesByExtension.has(ext)) {
            directFilesByExtension.set(ext, []);
            directCoverageByExtension.set(ext, true);
          }
          directFilesByExtension.get(ext)!.push(relative);
          if (!isSelected(relative)) {
            directCoverageByExtension.set(ext, false);
          }
        }
      }
    }

    const scanResult: DirectoryScan = {
      allFiles,
      directFilesByExtension,
      directCoverageByExtension,
      fullySelected
    };

    directoryScanCache.set(dir, scanResult);
    return scanResult;
  };

  for (const [dir, group] of dirGroups.entries()) {
    if (dir === '.') {
      continue;
    }

    const scan = getDirectoryScan(dir);
    const handledExtensions = new Set<string>();

    if (scan && isSelectedFileArray && group.extensions.size === 1) {
      const ext = Array.from(group.extensions)[0];
      if (ext && scan.directCoverageByExtension.get(ext)) {
        patterns.push(`${dir}/*${ext}`);
        markCovered(scan.directFilesByExtension.get(ext) ?? []);
        handledExtensions.add(ext);
        continue;
      }
    }

    if (scan && scan.fullySelected) {
      patterns.push(`${dir}/**`);
      markCovered(scan.allFiles);
      continue;
    }

    if (scan) {
      for (const ext of group.extensions) {
        if (!ext || handledExtensions.has(ext)) {
          continue;
        }

        if (scan.directCoverageByExtension.get(ext)) {
          patterns.push(`${dir}/*${ext}`);
          markCovered(scan.directFilesByExtension.get(ext) ?? []);
          handledExtensions.add(ext);
        }
      }
    }
  }

  for (const file of posixPaths) {
    const normalizedFile = normalizeForComparison(file);
    if (!coveredNormalized.has(normalizedFile)) {
      patterns.push(file);
      coveredNormalized.add(normalizedFile);
    }
  }

  return dedupeAndCompress(patterns);
}

function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function shouldUseCaseInsensitiveComparison(_root?: string): boolean {
  return process.platform === 'win32';
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function coverageKey(pattern: string): string {
  if (pattern.endsWith('/**')) {
    return pattern.slice(0, -3);
  }

  const starIndex = pattern.indexOf('/*');
  if (starIndex !== -1) {
    return pattern.substring(0, starIndex);
  }

  return pattern;
}

function dedupeAndCompress(patterns: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    if (!seen.has(pattern)) {
      seen.add(pattern);
      deduped.push(pattern);
    }
  }

  const kept: string[] = [];
  const dirGlobs: string[] = [];

  const isCoveredByDirGlob = (key: string): boolean =>
    dirGlobs.some(dir => key === dir || key.startsWith(`${dir}/`));

  const removeCoveredPatterns = (dir: string) => {
    for (let i = kept.length - 1; i >= 0; i--) {
      const candidateKey = coverageKey(kept[i]);
      if (candidateKey === dir || candidateKey.startsWith(`${dir}/`)) {
        kept.splice(i, 1);
      }
    }

    for (let i = dirGlobs.length - 1; i >= 0; i--) {
      const existing = dirGlobs[i];
      if (existing === dir || existing.startsWith(`${dir}/`)) {
        dirGlobs.splice(i, 1);
      }
    }
  };

  for (const pattern of deduped) {
    if (pattern.endsWith('/**')) {
      const dir = pattern.slice(0, -3);
      if (isCoveredByDirGlob(dir)) {
        continue;
      }

      removeCoveredPatterns(dir);
      dirGlobs.push(dir);
      kept.push(pattern);
      continue;
    }

    const key = coverageKey(pattern);
    if (isCoveredByDirGlob(key)) {
      continue;
    }

    kept.push(pattern);
  }

  return kept;
}
