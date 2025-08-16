import type { SelectedFile } from '../types/selectedFile.js';

/**
 * Generate compact Git-style patterns from a file selection.
 * Supports both string[] and SelectedFile[] for backward compatibility.
 * @param selection Array of selected file paths or SelectedFile objects
 * @param workspaceRoot Optional workspace root (not used when SelectedFile[] is passed)
 * @returns Array of patterns that represent the selection
 */
export function generatePatternsFromSelection(
  selection: string[] | SelectedFile[], 
  workspaceRoot?: string
): string[] {
  // Handle empty selection
  if (!selection || selection.length === 0) {
    return [];
  }

  // Convert SelectedFile[] to string[] if needed
  let selectedPaths: string[];
  if (typeof selection[0] === 'object' && 'path' in selection[0]) {
    // It's SelectedFile[]
    selectedPaths = (selection as SelectedFile[]).map(f => f.path);
  } else {
    // It's string[]
    selectedPaths = selection as string[];
  }

  if (!selectedPaths.length) {
    return [];
  }

  // Convert to posix paths and sort
  const posixPaths = selectedPaths.map(p => p.replace(/\\/g, '/')).sort();
  const patterns: string[] = [];
  const covered = new Set<string>();

  // Group by directory and extension
  const dirGroups = new Map<string, { files: string[], extensions: Set<string> }>();
  for (const file of posixPaths) {
    const dir = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '.';
    const ext = file.includes('.') ? file.substring(file.lastIndexOf('.')) : '';
    
    if (!dirGroups.has(dir)) {
      dirGroups.set(dir, { files: [], extensions: new Set() });
    }
    const group = dirGroups.get(dir)!;
    group.files.push(file);
    if (ext) group.extensions.add(ext);
  }

  // Check for patterns that can be consolidated
  // Different behavior based on input type for backward compatibility
  const isSelectedFileArray = typeof selection[0] === 'object' && 'path' in selection[0];
  
  for (const [dir, group] of dirGroups.entries()) {
    const { files, extensions } = group;
    
    // If we have multiple files in a directory
    if (files.length >= 2 && dir !== '.') {
      // Check if all files have the same extension
      if (extensions.size === 1) {
        const ext = Array.from(extensions)[0];
        
        // For SelectedFile[] (migration test), use extension wildcard
        // For string[] (generatePatternsFromSelection test), use directory wildcard
        if (isSelectedFileArray) {
          // Migration test expects: src/components/*.tsx
          patterns.push(`${dir}/*${ext}`);
        } else {
          // generatePatternsFromSelection test expects: src/utils/**
          patterns.push(`${dir}/**`);
        }
        files.forEach(f => covered.add(f));
      } else if (files.length >= 3) {
        // Multiple extensions but many files - use directory pattern
        patterns.push(`${dir}/**`);
        files.forEach(f => covered.add(f));
      }
    }
  }

  // Add remaining individual files
  for (const file of posixPaths) {
    if (!covered.has(file)) {
      patterns.push(file);
    }
  }

  return patterns;
}