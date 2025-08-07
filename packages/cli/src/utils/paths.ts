import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import { isInteractive } from './environment';

// Import readline for interactive prompts
import * as readline from 'readline';

/**
 * Get the cache directory for promptcode
 * Respects XDG_CACHE_HOME environment variable
 */
export function getCacheDir(): string {
  return process.env.XDG_CACHE_HOME 
    || path.join(os.homedir(), '.cache', 'promptcode');
}

/**
 * Get the config directory for promptcode
 * Respects XDG_CONFIG_HOME environment variable
 */
export function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME 
    || path.join(os.homedir(), '.config', 'promptcode');
}

/**
 * Find .promptcode folder in current or parent directories
 * Similar to how git finds .git folder
 */
export function findPromptcodeFolder(startPath: string): string | null {
  let currentPath = path.resolve(startPath);
  const root = path.parse(currentPath).root;
  
  while (currentPath !== root) {
    const candidatePath = path.join(currentPath, '.promptcode');
    if (fsSync.existsSync(candidatePath)) {
      return candidatePath;
    }
    
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break; // Reached root
    currentPath = parentPath;
  }
  
  return null;
}

/**
 * Get the templates directory for Claude integration.
 * Works correctly for both development and compiled Bun binaries.
 */
export function getClaudeTemplatesDir(): string {
  // For compiled Bun binaries, templates are in dist/claude-templates
  const execDir = path.dirname(process.execPath);
  const compiledPath = path.join(execDir, 'claude-templates');
  
  if (fsSync.existsSync(compiledPath)) {
    return compiledPath;
  }
  
  // For development mode, use __dirname relative path
  // This will be resolved at compile time
  const devPath = path.join(__dirname, '..', 'claude-templates');
  if (fsSync.existsSync(devPath)) {
    return devPath;
  }
  
  // Fallback: check if we're running from packages/cli/dist
  const distPath = path.join(process.cwd(), 'packages', 'cli', 'dist', 'claude-templates');
  if (fsSync.existsSync(distPath)) {
    return distPath;
  }
  
  throw new Error('Claude templates directory not found. Please rebuild the CLI.');
}

/**
 * Get the preset directory for a project
 * Now searches for existing .promptcode in parent directories
 */
export function getPresetDir(projectPath: string): string {
  const existingPromptcodeDir = findPromptcodeFolder(projectPath);
  if (existingPromptcodeDir) {
    return path.join(existingPromptcodeDir, 'presets');
  }
  // Default to creating in current project directory
  return path.join(projectPath, '.promptcode', 'presets');
}

/**
 * Request user approval for directory creation
 */
async function requestDirectoryCreation(dirPath: string, dirType: string): Promise<boolean> {
  // In test mode, auto-approve directory creation
  if (process.env.PROMPTCODE_TEST === '1') {
    return true;
  }
  
  if (!isInteractive()) {
    console.error(chalk.red(`Cannot create ${dirType} directory in non-interactive mode.`));
    console.error(chalk.yellow(`Please create the directory manually: ${dirPath}`));
    return false;
  }

  console.log(chalk.yellow(`\n⚠️  The ${dirType} directory does not exist:`));
  console.log(chalk.gray(`   ${dirPath}`));
  console.log(chalk.cyan(`\nWould you like to create it? (y/n) `));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Ensure a directory exists with user approval
 */
export async function ensureDirWithApproval(dirPath: string, dirType: string): Promise<boolean> {
  if (fsSync.existsSync(dirPath)) {
    return true;
  }

  // Determine what needs to be created
  const parentDir = path.dirname(dirPath);
  const needsParentCreation = !fsSync.existsSync(parentDir);
  
  if (needsParentCreation) {
    // Need to create parent directories too
    const parts = dirPath.split(path.sep);
    let firstMissing = '';
    let currentCheck = '';
    
    for (const part of parts) {
      currentCheck = currentCheck ? path.join(currentCheck, part) : part;
      if (!fsSync.existsSync(currentCheck) && !firstMissing) {
        firstMissing = currentCheck;
        break;
      }
    }
    
    console.log(chalk.yellow(`\n📁 This will create the following directory structure:`));
    console.log(chalk.gray(`   ${firstMissing} ${firstMissing !== dirPath ? `(and subdirectories)` : ''}`));
  }

  const approved = await requestDirectoryCreation(dirPath, dirType);
  
  if (approved) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      console.log(chalk.green(`✓ Created ${dirType} directory: ${dirPath}`));
      return true;
    } catch (error) {
      console.error(chalk.red(`Failed to create directory: ${error}`));
      return false;
    }
  }
  
  return false;
}

/**
 * Assert that a path is inside the given root directory
 * Throws an error if the path escapes the root
 */
export function assertInsideRoot(root: string, candidatePath: string): void {
  const absRoot = path.resolve(root) + path.sep;
  const absCandidate = path.resolve(root, candidatePath);
  
  if (!absCandidate.startsWith(absRoot)) {
    throw new Error(`Path traversal attempt blocked: ${candidatePath}`);
  }
}

/**
 * Resolve project path from options or current directory
 */
export function resolveProjectPath(pathOption?: string): string {
  return path.resolve(pathOption || process.cwd());
}

/**
 * Get the history file path
 */
export function getHistoryPath(): string {
  return path.join(getConfigDir(), 'history.json');
}