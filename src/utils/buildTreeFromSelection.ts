import * as path from 'node:path';
import type { SelectedFile } from '@promptcode/core';

/**
 * Builds a POSIX-style directory tree string from a list of selected files.
 *
 * @param selected An array of SelectedFile objects.
 * @returns A string representing the directory tree.
 */
export function buildTreeFromSelection(selected: SelectedFile[]): string {
  // 1. Group files by workspace root and build a nested structure
  const groupedByRoot: Record<string, Record<string, unknown>> = {};

  for (const file of selected) {
    // Use POSIX paths internally for consistency building the structure
    // Normalize ensures consistent separator usage and resolves '..' etc.
    const root = path.posix.normalize(file.workspaceFolderRootPath.replace(/\\/g, '/'));
    const relativePath = path.posix.relative(root, file.path.replace(/\\/g, '/'));

    groupedByRoot[root] ??= {};
    const parts = relativePath.split(path.posix.sep).filter(p => p.length > 0); // Filter empty strings from leading/trailing slashes
    let node = groupedByRoot[root];

    // Create nested objects for directories
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      node[part] ??= {};
      node = node[part] as Record<string, unknown>;
    }

    // Mark the file (leaf node)
    const fileName = parts.at(-1);
    if (fileName) {
        node[fileName] = true; // Mark as a file (leaf)
    }
  }

  // 2. Render the tree structure for each root
  const render = (node: Record<string, unknown>, indent = ''): string =>
    Object.keys(node)
      .sort((a, b) => {
        // Sort directories before files, then alphabetically
        const aIsDir = typeof node[a] === 'object';
        const bIsDir = typeof node[b] === 'object';
        if (aIsDir === bIsDir) {
          return a.localeCompare(b); // Alphabetical for same types
        }
        return aIsDir ? -1 : 1; // Directories first
      })
      .map((key, index, arr) => {
        const isLast = index === arr.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childIndent = indent + (isLast ? '    ' : '│   ');
        const isDir = typeof node[key] === 'object';

        const entry = `${indent}${connector}${key}${isDir ? '/' : ''}\n`; // Explicit newline
        const children = isDir ? render(node[key] as Record<string, unknown>, childIndent) : '';
        return entry + children;
      })
      .join(''); // Join lines directly

  // 3. Combine trees from all workspace roots
  return Object.entries(groupedByRoot)
    .map(([rootPath, tree]) => {
      // Extract the last part of the root path for display
      const rootName = rootPath.split(path.posix.sep).pop() || rootPath;
      // Render the root directory name and its tree content, ensuring trailing newline for the block
      return `${rootName}/\n${render(tree).replace(/\n$/, '')}`; // Render, remove trailing newline from render if any
    })
    .join('\n'); // Join multiple root trees with a newline
}
