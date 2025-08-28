import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import { isInteractive } from './environment';
import { BUILD_VERSION } from '../version';
import { getEmbeddedTemplates, hasEmbeddedTemplates } from '../embedded-templates';

// Import readline for interactive prompts
import * as readline from 'readline';

/**
 * Get the cache directory for promptcode
 * Respects XDG_CACHE_HOME environment variable
 */
export function getCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'promptcode');
}

/**
 * Get the config directory for promptcode
 * Respects XDG_CONFIG_HOME environment variable
 */
export function getConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'promptcode');
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
      try {
        const st = fsSync.lstatSync(candidatePath);
        if (st.isDirectory() && !st.isSymbolicLink()) {
          return candidatePath;
        }
      } catch { /* continue */ }
    }
    
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {break;} // Reached root
    currentPath = parentPath;
  }
  
  return null;
}

/**
 * Get the project root directory (parent of .promptcode folder)
 * This is where preset patterns are relative to
 */
export function getProjectRoot(startPath: string): string {
  const promptcodeFolder = findPromptcodeFolder(startPath);
  if (promptcodeFolder) {
    // Return parent of .promptcode
    return path.dirname(promptcodeFolder);
  }
  // Default to current directory if no .promptcode found
  return path.resolve(startPath);
}

/**
 * Get the templates directory for Claude integration.
 * Works correctly for development, local binaries, and global installations.
 */
export function getClaudeTemplatesDir(): string {
  // 1) Try embedded templates (works for compiled binaries and global installs)
  if (hasEmbeddedTemplates()) {
    try {
      const templates = getEmbeddedTemplates();
      
      // Use versioned cache directory to avoid stale copies
      const cacheBase = getCacheDir();
      const templatesDir = path.join(cacheBase, 'claude-templates', BUILD_VERSION);
      
      // Create cache directory if it doesn't exist
      if (!fsSync.existsSync(templatesDir)) {
        fsSync.mkdirSync(templatesDir, { recursive: true });
      }
      
      // Write templates to cache (idempotent - only writes if changed)
      for (const [filename, content] of Object.entries(templates)) {
        const filePath = path.join(templatesDir, filename);
        
        // Check if we need to write the file
        let needsWrite = true;
        try {
          if (fsSync.existsSync(filePath)) {
            const existing = fsSync.readFileSync(filePath, 'utf8');
            needsWrite = existing !== content;
          }
        } catch {
          needsWrite = true;
        }
        
        if (needsWrite) {
          fsSync.writeFileSync(filePath, content, 'utf8');
        }
      }
      
      return templatesDir;
    } catch (error) {
      // If cache write fails, try temp directory as fallback
      try {
        const tempDir = path.join(os.tmpdir(), 'promptcode', 'claude-templates', BUILD_VERSION);
        if (!fsSync.existsSync(tempDir)) {
          fsSync.mkdirSync(tempDir, { recursive: true });
          
          const templates = getEmbeddedTemplates();
          for (const [filename, content] of Object.entries(templates)) {
            fsSync.writeFileSync(path.join(tempDir, filename), content, 'utf8');
          }
        }
        return tempDir;
      } catch {
        // Continue to filesystem fallbacks
      }
    }
  }
  
  // 2) Development/local fallback - check relative to __dirname
  const devPath = path.join(__dirname, '..', 'claude-templates');
  if (fsSync.existsSync(devPath)) {
    return devPath;
  }
  
  // 3) Check if running from packages/cli/dist (for local testing)
  const distPath = path.join(process.cwd(), 'packages', 'cli', 'dist', 'claude-templates');
  if (fsSync.existsSync(distPath)) {
    return distPath;
  }
  
  // 4) Last resort - check source directory for development
  const srcPath = path.join(__dirname, '..', '..', 'src', 'claude-templates');
  if (fsSync.existsSync(srcPath)) {
    return srcPath;
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
 * Get the full path to a preset file
 * Searches for existing .promptcode folder in parent directories
 */
export function getPresetPath(projectPath: string, presetName: string): string {
  const presetsDir = getPresetDir(projectPath);
  return path.join(presetsDir, `${presetName}.patterns`);
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
 * Check if a directory path is safe to remove
 * Prevents accidental deletion of critical system directories
 */
export function isSafeToRemove(dirPath: string): boolean {
  const normalized = path.resolve(dirPath);
  const home = os.homedir();
  
  // Never remove critical directories
  const criticalPaths = [
    '/',
    home,
    path.join(home, '.config'),  // XDG config base
    path.join(home, '.cache'),   // XDG cache base
    path.join(home, '.local'),   // XDG data base
    '/etc',
    '/usr',
    '/var',
    '/bin',
    '/sbin',
    '/lib',
    '/opt',
    '/home',
    '/Users',
    'C:\\',
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\Users',
  ];
  
  // Also check if XDG env vars are set and protect those base directories
  if (process.env.XDG_CONFIG_HOME) {
    criticalPaths.push(path.resolve(process.env.XDG_CONFIG_HOME));
  }
  if (process.env.XDG_CACHE_HOME) {
    criticalPaths.push(path.resolve(process.env.XDG_CACHE_HOME));
  }
  if (process.env.XDG_DATA_HOME) {
    criticalPaths.push(path.resolve(process.env.XDG_DATA_HOME));
  }
  
  // Check if the path is one of the critical directories
  if (criticalPaths.includes(normalized)) {
    return false;
  }
  
  // Check if the path is outside user home (with exceptions for temp dirs)
  const isInHome = normalized.startsWith(home);
  const isInTemp = normalized.startsWith(os.tmpdir()) || normalized.startsWith('/tmp') || normalized.startsWith('/var/tmp');
  
  // If outside both home and temp directories, reject
  if (!isInHome && !isInTemp) {
    return false;
  }
  
  // Path must contain 'promptcode' in its name for safety
  // This prevents accidental deletion of unrelated directories
  if (!normalized.toLowerCase().includes('promptcode')) {
    return false;
  }
  
  return true;
}

/**
 * Resolve project path from options or current directory
 * Intelligently finds the project root by looking for .promptcode folder
 */
export function resolveProjectPath(pathOption?: string): string {
  // Start from the provided path or current directory
  const startPath = path.resolve(pathOption || process.cwd());
  
  // Try to find project root by looking for .promptcode folder
  const promptcodeFolder = findPromptcodeFolder(startPath);
  if (promptcodeFolder) {
    // Return the parent of .promptcode (the project root)
    return path.dirname(promptcodeFolder);
  }
  
  // If no .promptcode found, return the resolved start path
  // This allows the tool to work in projects without .promptcode yet
  return startPath;
}

/**
 * Get the history file path
 */
export function getHistoryPath(): string {
  return path.join(getConfigDir(), 'history.json');
}

/**
 * Get the templates directory for Cursor integration.
 * Works correctly for development, local binaries, and global installations.
 */
export function getCursorTemplatesDir(): string {
  // 1) Try embedded templates (works for compiled binaries and global installs)
  if (hasEmbeddedTemplates()) {
    try {
      const templates = getEmbeddedTemplates();
      
      // Use versioned cache directory to avoid stale copies
      const cacheBase = getCacheDir();
      const templatesDir = path.join(cacheBase, 'cursor-templates', BUILD_VERSION);
      
      // Create cache directory if it doesn't exist
      if (!fsSync.existsSync(templatesDir)) {
        fsSync.mkdirSync(templatesDir, { recursive: true });
      }
      
      // Write templates to cache (idempotent - only writes if changed)
      for (const [filename, content] of Object.entries(templates)) {
        const filePath = path.join(templatesDir, filename);
        
        // Check if we need to write the file
        let needsWrite = true;
        try {
          if (fsSync.existsSync(filePath)) {
            const existing = fsSync.readFileSync(filePath, 'utf8');
            needsWrite = existing !== content;
          }
        } catch {
          needsWrite = true;
        }
        
        if (needsWrite) {
          fsSync.writeFileSync(filePath, content, 'utf8');
        }
      }
      
      return templatesDir;
    } catch (error) {
      // If cache write fails, try temp directory as fallback
      try {
        const tempDir = path.join(os.tmpdir(), 'promptcode', 'cursor-templates', BUILD_VERSION);
        if (!fsSync.existsSync(tempDir)) {
          fsSync.mkdirSync(tempDir, { recursive: true });
          
          const templates = getEmbeddedTemplates();
          for (const [filename, content] of Object.entries(templates)) {
            fsSync.writeFileSync(path.join(tempDir, filename), content, 'utf8');
          }
        }
        return tempDir;
      } catch {
        // Continue to filesystem fallbacks
      }
    }
  }
  
  // 2) Development/local fallback - check relative to __dirname
  const devPath = path.join(__dirname, '..', 'cursor-templates');
  if (fsSync.existsSync(devPath)) {
    return devPath;
  }
  
  // 3) Check if running from packages/cli/dist (for local testing)
  const distPath = path.join(process.cwd(), 'packages', 'cli', 'dist', 'cursor-templates');
  if (fsSync.existsSync(distPath)) {
    return distPath;
  }
  
  // 4) Last resort - check source directory for development
  const srcPath = path.join(__dirname, '..', '..', 'src', 'cursor-templates');
  if (fsSync.existsSync(srcPath)) {
    return srcPath;
  }
  
  throw new Error('Cursor templates directory not found. Please rebuild the CLI.');
}