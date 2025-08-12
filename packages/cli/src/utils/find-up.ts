import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Generic utility to find a file or directory by traversing up the directory tree.
 * Stops at home directory or root to avoid going too high up.
 * 
 * @param name - Name of the file or directory to find
 * @param startPath - Starting path to search from
 * @param type - Whether to look for a file or directory
 * @param options - Additional options
 * @returns Full path if found, null otherwise
 */
export function findUp(
  name: string,
  startPath: string,
  type: 'file' | 'directory',
  options: { 
    stopAt?: string;
    followSymlinks?: boolean;
  } = {}
): string | null {
  let currentPath = path.resolve(startPath);
  const root = path.parse(currentPath).root;
  const homeDir = os.homedir();
  const stopAt = options.stopAt || homeDir;
  
  // Track visited paths to prevent infinite loops with symlinks
  const visited = new Set<string>();
  
  while (currentPath !== root) {
    // Check if we've visited this path before
    if (visited.has(currentPath)) {
      break;
    }
    visited.add(currentPath);
    
    // Stop if we've reached the stop directory (usually home) or above
    if (currentPath === stopAt || currentPath === path.dirname(stopAt)) {
      break;
    }
    
    const targetPath = path.join(currentPath, name);
    
    try {
      // Use lstatSync for security (doesn't follow symlinks)
      const stats = options.followSymlinks 
        ? fs.statSync(targetPath) 
        : fs.lstatSync(targetPath);
      
      if (type === 'file' && stats.isFile()) {
        return targetPath;
      } else if (type === 'directory' && stats.isDirectory()) {
        return targetPath;
      }
    } catch {
      // File/directory doesn't exist, continue searching
    }
    
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break; // Reached root
    currentPath = parentPath;
  }
  
  return null;
}

/**
 * Convenience function to find a directory
 */
export function findUpDirectory(name: string, startPath: string): string | null {
  return findUp(name, startPath, 'directory');
}

/**
 * Convenience function to find a file
 */
export function findUpFile(name: string, startPath: string): string | null {
  return findUp(name, startPath, 'file');
}