import * as fs from 'fs';
import * as path from 'path';

/**
 * Detect if a string is a glob pattern
 * Checks for common glob special characters and patterns
 */
export function isGlobPattern(input: string): boolean {
  // Check for negation pattern (! at the start)
  if (input.startsWith('!')) {
    return true;
  }
  
  // Check for common glob indicators
  if (input.includes('*') || input.includes('?')) {
    return true;
  }
  
  // Brace expansion: {a,b,c} or brace ranges: {1..3}
  if (/\{.*,.*\}/.test(input) || /\{.*\.\..*\}/.test(input)) {
    return true;
  }
  
  // Extended glob patterns
  if (input.includes('?(') || input.includes('*(') || 
      input.includes('+(') || input.includes('@(') || 
      input.includes('!(')) {
    return true;
  }
  
  // Conservative character class detection
  // Only treat as pattern if it contains:
  // - A range (e.g., [0-9], [a-z])
  // - A POSIX class (e.g., [:alpha:])
  // - Multiple characters (e.g., [abc], [!abc])
  // This avoids false positives for literal filenames like file[1].ts
  // Check ALL bracket pairs, not just the first one
  const bracketRe = /(?<!\\)\[([^\]]+)\]/g;
  let match;
  while ((match = bracketRe.exec(input)) !== null) {
    const content = match[1];
    // Check if it's a character class pattern
    if (content.includes('-') ||           // Range like [0-9]
        /:\w+:/.test(content) ||           // POSIX class like [:alpha:]
        content.length >= 2) {             // Multiple chars like [abc]
      return true;
    }
  }
  
  return false;
}

/**
 * Normalize patterns for cross-platform compatibility
 * Converts Windows paths to POSIX format
 */
export function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/');
}

/**
 * Classify an input as a glob pattern, directory, or file
 * @param input The input string to classify
 * @param basePath Optional base path for resolving relative paths
 */
export function classifyInput(input: string, basePath?: string): 'pattern' | 'directory' | 'file' {
  // Normalize the input for consistency and remove trailing slashes
  const normalized = normalizePattern(input).replace(/\/$/, '');
  
  // Check if it's a glob pattern first
  if (isGlobPattern(normalized)) {
    return 'pattern';
  }
  
  // Check if it exists on the file system
  try {
    // Use the original input (not normalized) for path resolution to handle OS-specific paths
    const inputForResolve = input.replace(/\/$/, ''); // Remove trailing slash
    const resolvedPath = basePath ? path.resolve(basePath, inputForResolve) : path.resolve(inputForResolve);
    const stats = fs.statSync(resolvedPath);
    
    if (stats.isDirectory()) {
      return 'directory';
    }
    return 'file';
  } catch {
    // If it doesn't exist, treat it as a file path
    // This allows for files that will be created later
    return 'file';
  }
}

/**
 * Separate glob patterns, directories, and file paths
 * @param inputs Array of input strings (patterns or paths)
 * @param basePath Optional base path for resolving relative paths
 */
export function separatePatternsFromPaths(inputs: string[], basePath?: string): {
  patterns: string[];    // Glob patterns to preserve as-is
  directories: string[]; // Directory paths to convert to dir/**
  files: string[];      // File paths to optimize
  mixed: boolean;       // Whether we have mixed input types
} {
  const patterns: string[] = [];
  const directories: string[] = [];
  const files: string[] = [];
  
  for (const input of inputs) {
    const normalized = normalizePattern(input);
    const type = classifyInput(normalized, basePath);
    
    switch (type) {
      case 'pattern':
        patterns.push(normalized);
        break;
      case 'directory':
        directories.push(normalized);
        break;
      case 'file':
        files.push(normalized);
        break;
    }
  }
  
  const mixed = 
    (patterns.length > 0 && (directories.length > 0 || files.length > 0)) ||
    (directories.length > 0 && files.length > 0);
  
  return { patterns, directories, files, mixed };
}

/**
 * Validate patterns are safe (no directory traversal)
 * @param patterns Array of patterns to validate
 * @throws Error if any pattern is unsafe
 */
export function validatePatternSafety(patterns: string[]): void {
  for (const original of patterns) {
    // Strip any leading negation(s) for safety checks
    const pattern = original.replace(/^!+/, '');
    
    // Check for directory traversal attempts
    // But allow .. in brace ranges like {1..3}
    if (pattern.includes('../') || pattern.includes('..\\') || 
        (pattern.includes('..') && !/{[^}]*\.\.[^}]*}/.test(pattern))) {
      throw new Error(`Unsafe pattern with directory traversal: ${original}`);
    }
    
    // Check for absolute paths (disallow on all platforms for consistency)
    if (path.isAbsolute(pattern)) {
      throw new Error(`Unsafe absolute path pattern: ${original}. Patterns must be relative to the project root.`);
    }
  }
}

/**
 * Convert a directory path to a glob pattern
 * @param dirPath Directory path
 * @returns Glob pattern for all files in the directory
 */
export function directoryToPattern(dirPath: string): string {
  const normalized = normalizePattern(dirPath);
  // Remove trailing slash if present
  const cleaned = normalized.replace(/\/$/, '');
  return `${cleaned}/**`;
}