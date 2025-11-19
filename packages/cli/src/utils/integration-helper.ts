import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { ensureDirWithApproval, isTooHighUp } from './paths';

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