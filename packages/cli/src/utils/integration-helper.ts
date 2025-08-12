import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import { ensureDirWithApproval } from './paths';

/**
 * Check if a directory is too high up in the file system
 * (e.g., user home, root, or their immediate children)
 */
function isTooHighUp(dirPath: string): boolean {
  const homeDir = os.homedir();
  const normalizedPath = path.normalize(dirPath);
  const normalizedHome = path.normalize(homeDir);
  
  // Don't allow in home directory or its immediate children
  if (normalizedPath === normalizedHome) {
    return true;
  }
  
  // Don't allow in immediate children of home (like ~/.cursor)
  const parentOfDir = path.dirname(normalizedPath);
  if (parentOfDir === normalizedHome) {
    return true;
  }
  
  // Don't allow at root or its immediate children
  const root = path.parse(normalizedPath).root;
  if (normalizedPath === root || path.dirname(normalizedPath) === root) {
    return true;
  }
  
  return false;
}

/**
 * Find or create an integration directory (.claude or .cursor)
 * Logic:
 * 1. Check if directory exists in current folder
 * 2. If not, check parent directories (for monorepo support)
 * 3. If found anywhere (but not too high up), use it
 * 4. If not found, create new one in current directory (with approval)
 */
export async function findOrCreateIntegrationDir(
  projectPath: string,
  dirName: '.claude' | '.cursor',
  findFunction: (path: string) => string | null
): Promise<{ dir: string | null; isNew: boolean }> {
  // Check if directory exists in current directory first
  const localDir = path.join(projectPath, dirName);
  
  // Check if local directory would be too high up (e.g., user is running from home)
  if (isTooHighUp(localDir)) {
    console.log(chalk.red(`Cannot create ${dirName} in ${projectPath} - location is too high in filesystem hierarchy`));
    return { dir: null, isNew: false };
  }
  
  if (fs.existsSync(localDir)) {
    // Use existing local directory
    return { dir: localDir, isNew: false };
  }
  
  // Check for directory in parent directories (monorepo support)
  const parentDir = findFunction(projectPath);
  
  if (parentDir && !isTooHighUp(parentDir)) {
    // Found in parent directory and it's not too high up - use it for monorepo
    return { dir: parentDir, isNew: false };
  }
  
  // No directory found anywhere - create new one in current directory
  const approved = await ensureDirWithApproval(localDir, dirName);
  if (!approved) {
    return { dir: null, isNew: false };
  }
  
  return { dir: localDir, isNew: true };
}