import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

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
 * Get the preset directory for a project
 */
export function getPresetDir(projectPath: string): string {
  return path.join(projectPath, '.promptcode', 'presets');
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
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