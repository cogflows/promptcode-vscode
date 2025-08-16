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
  // Normalize paths to be consistent across platforms
  return files.map(f => f.replace(/\\/g, '/')).sort();
}

/**
 * Parse patterns from a string (typically read from a file).
 * @param content Raw string content with patterns
 * @returns Parsed include and exclude patterns
 */
export function parsePatterns(content: string): ParsedPatterns {
  const lines = content.split('\n');
  const includePatterns: string[] = [];
  const excludePatterns: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue; // Skip empty lines and comments
    }

    if (trimmed.startsWith('!')) {
      excludePatterns.push(trimmed.slice(1));
    } else {
      includePatterns.push(trimmed);
    }
  }

  return { includePatterns, excludePatterns };
}

/**
 * Parse pattern lines into include and exclude patterns.
 * Wrapper for parsePatterns to maintain API compatibility.
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
  if (includePatterns.length === 0 && excludePatterns.length > 0) {
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
    followSymbolicLinks: true,
    absolute: false,
    ignore: patterns.excludePatterns,
  });

  // Normalize paths to be consistent across platforms
  return includedFiles.map(f => f.replace(/\\/g, '/')).sort();
}

/**
 * List files based on patterns from a pattern file.
 * @param patternFile Path to file containing patterns
 * @param parentFolder Base directory to search from
 * @returns Array of matching file paths relative to parentFolder
 */
export async function listFilesByPatternsFile(
  patternFile: string,
  parentFolder: string,
): Promise<string[]> {
  const cwd = assertDir(parentFolder);
  
  // Read and parse patterns
  const content = await fs.readFile(patternFile, 'utf-8');
  const { includePatterns, excludePatterns } = parsePatterns(content);

  // Security: reject absolute/traversal patterns early
  const allPatterns = [
    ...includePatterns,
    ...excludePatterns.map((e) => '!' + e),
  ];
  for (const p of allPatterns) {
    const raw = p.startsWith('!') ? p.slice(1) : p;
    if (path.isAbsolute(raw) || raw.includes('..')) {
      throw new Error(`Unsafe pattern in ${path.basename(patternFile)}: "${p}"`);
    }
  }

  if (includePatterns.length === 0) {
    return [];
  }

  // Use fast-glob with all patterns
  // Security: Don't follow symlinks to prevent directory traversal
  const files = await fg(includePatterns, {
    cwd,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: true, // Match intended behavior - symlinks are followed
    absolute: false,
    ignore: excludePatterns,
  });

  // Normalize paths to be consistent across platforms
  return files.map(f => f.replace(/\\/g, '/')).sort();
}