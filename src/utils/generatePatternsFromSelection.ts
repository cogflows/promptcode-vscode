import * as path from 'path';
import * as fs from 'fs';

/**
 * Get all files recursively in a directory
 */
function getAllFilesInDir(dir: string, workspaceRoot: string): string[] {
  const absDir = path.join(workspaceRoot, dir);
  const allFiles: string[] = [];
  
  function walkDir(currentPath: string, relativePath: string) {
    try {
      const entries = fs.readdirSync(currentPath);
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry);
        const relPath = path.join(relativePath, entry);
        const stat = fs.statSync(fullPath);
        
        if (stat.isFile()) {
          allFiles.push(relPath);
        } else if (stat.isDirectory()) {
          walkDir(fullPath, relPath);
        }
      }
    } catch (err) {
      console.warn(`Error walking directory ${currentPath}:`, err);
    }
  }
  
  if (fs.existsSync(absDir) && fs.statSync(absDir).isDirectory()) {
    walkDir(absDir, dir);
  }
  
  return allFiles;
}

/**
 * Generate compact Git-style patterns from a file selection.
 * @param selectedPaths Array of selected file paths (relative to workspace root)
 * @param workspaceRoot Absolute path to workspace root
 * @returns Array of patterns that represent the selection
 */
export function generatePatternsFromSelection(
  selectedPaths: string[], 
  workspaceRoot: string
): string[] {
  if (selectedPaths.length === 0) {
    return [];
  }

  const selectedSet = new Set(selectedPaths);
  const patterns: string[] = [];
  const coveredPaths = new Set<string>();

  // Build a map of directories to check
  const dirsToCheck = new Map<string, string[]>();
  
  // Collect all directories that contain selected files
  for (const filePath of selectedPaths) {
    let dir = path.dirname(filePath);
    
    // Walk up the directory tree
    while (dir && dir !== '.') {
      if (!dirsToCheck.has(dir)) {
        dirsToCheck.set(dir, []);
      }
      dir = path.dirname(dir);
    }
  }

  // For each directory, check if ALL files in it (recursively) are selected
  const dirsWithFullCoverage: string[] = [];
  
  for (const dir of dirsToCheck.keys()) {
    const allFilesInDir = getAllFilesInDir(dir, workspaceRoot);
    const allSelected = allFilesInDir.every(f => selectedSet.has(f));
    
    if (allSelected && allFilesInDir.length > 0) {
      dirsWithFullCoverage.push(dir);
    }
  }

  // Sort by depth (deepest first) to avoid adding parent dirs when child dirs are already covered
  dirsWithFullCoverage.sort((a, b) => {
    const depthA = a.split(path.sep).length;
    const depthB = b.split(path.sep).length;
    return depthB - depthA;
  });

  // Add directory patterns for fully covered directories
  for (const dir of dirsWithFullCoverage) {
    // Check if this directory is already covered by a subdirectory pattern
    const alreadyCovered = patterns.some(p => {
      const patternDir = p.endsWith('/**') ? p.slice(0, -3) : '';
      return patternDir && dir.startsWith(patternDir + '/');
    });
    
    if (!alreadyCovered) {
      patterns.push(`${dir}/**`);
      // Mark all files in this directory as covered
      const allFilesInDir = getAllFilesInDir(dir, workspaceRoot);
      allFilesInDir.forEach(f => coveredPaths.add(f));
    }
  }

  // Add individual files not covered by directory patterns
  for (const file of selectedPaths) {
    if (!coveredPaths.has(file)) {
      patterns.push(file);
    }
  }

  return patterns.sort();
}