import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import fg from 'fast-glob';

export interface ParsedPatterns {
  includePatterns: string[];
  excludePatterns: string[];
}

/**
 * Validate that dir exists and is a directory.
 * @param dir Directory path to validate
 * @returns Resolved absolute path
 */
function assertDir(dir: string): string {
  const full = path.resolve(dir);
  try {
    const stat = fsSync.statSync(full); // Use sync for quick check
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${dir}`);
    }
  } catch (err) {
    throw new Error(`Directory validation failed: ${dir} - ${(err as Error).message}`);
  }
  return full;
}

/**
 * Return files (relative paths) that match a single Git-style pattern.
 * @param pattern Git-style pattern
 * @param parentFolder Base directory to search from
 * @returns Array of matching file paths relative to parentFolder
 */
export async function listFilesByPattern(
  pattern: string,
  parentFolder: string,
): Promise<string[]> {
  const cwd = assertDir(parentFolder);
  const files = await fg([pattern], {
    cwd,
    onlyFiles: true,
    dot: true, // Match hidden files
    followSymbolicLinks: true, // Match intended behavior - symlinks are followed
    absolute: false, // Return relative paths
  });
  return files.sort();
}

/**
 * Parse pattern lines into include and exclude patterns.
 * @param lines Array of pattern lines
 * @returns Parsed patterns object
 */
export function parsePatternLines(lines: string[]): ParsedPatterns {
  const includePatterns: string[] = [];
  const excludePatterns: string[] = [];
  
  const cleanLines = lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#')); // Skip empty lines and comments
  
  for (const pattern of cleanLines) {
    if (pattern.startsWith('!')) {
      // Exclusion pattern - remove the ! prefix
      excludePatterns.push(pattern.substring(1));
    } else {
      // Inclusion pattern
      includePatterns.push(pattern);
    }
  }

  // If no inclusion patterns, include everything by default
  if (includePatterns.length === 0) {
    includePatterns.push('**/*');
  }

  return { includePatterns, excludePatterns };
}

/**
 * Get files matching the given patterns.
 * @param patterns Parsed patterns object
 * @param cwd Working directory
 * @returns Array of matching file paths
 */
export async function getFilesMatchingPatterns(
  patterns: ParsedPatterns,
  cwd: string
): Promise<string[]> {
  const includedFiles = await fg(patterns.includePatterns, {
    cwd,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: true, // Match intended behavior - symlinks are followed
    absolute: false,
    ignore: patterns.excludePatterns, // fast-glob handles exclusions via ignore option
  });

  return includedFiles.sort();
}

/**
 * Evaluate a whole patterns file (like .gitignore). Returns included files (relative paths).
 * @param patternFile Path to the patterns file
 * @param parentFolder Base directory for pattern matching
 * @returns Array of included file paths relative to parentFolder
 */
export async function listFilesByPatternsFile(
  patternFile: string,
  parentFolder: string,
): Promise<string[]> {
  const cwd = assertDir(parentFolder);
  const raw = await fs.readFile(patternFile, 'utf8');
  const lines = raw.split(/\r?\n/);
  
  const patterns = parsePatternLines(lines);
  return getFilesMatchingPatterns(patterns, cwd);
}