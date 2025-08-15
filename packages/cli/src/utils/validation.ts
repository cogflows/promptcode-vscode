import * as path from 'path';

/**
 * Validates that file patterns don't contain security risks
 * @param patterns Array of file patterns to validate
 * @throws Error if any pattern is invalid
 */
export function validatePatterns(patterns: string[]): void {
  const invalid = patterns.find((p) => {
    // Check for absolute paths
    if (path.isAbsolute(p)) return true;
    // Check for path traversal
    if (p.includes('..')) return true;
    return false;
  });
  
  if (invalid) {
    throw new Error(
      `Invalid file pattern detected: "${invalid}". Absolute paths and ".." segments are not allowed.`
    );
  }
}

/**
 * Validates a preset name for security and filesystem compatibility
 * @param presetName The preset name to validate
 * @throws Error if the preset name is invalid
 */
export function validatePresetName(presetName: string): void {
  if (!/^[a-z0-9_-]+$/i.test(presetName)) {
    throw new Error(
      'Invalid preset name. Use only letters, numbers, hyphens, and underscores.'
    );
  }
  
  // Additional security checks
  const forbidden = ['..', '/', '\\', '~', '.', '__proto__', 'constructor', 'prototype'];
  const nameLower = presetName.toLowerCase();
  
  for (const word of forbidden) {
    if (nameLower.includes(word)) {
      throw new Error(
        `Invalid preset name. The name cannot contain "${word}".`
      );
    }
  }
  
  // Check for reserved names
  const reserved = ['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 
                   'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 
                   'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'];
  
  if (reserved.includes(nameLower)) {
    throw new Error(
      `Invalid preset name. "${presetName}" is a reserved system name.`
    );
  }
  
  // Length limits
  if (presetName.length === 0) {
    throw new Error('Preset name cannot be empty.');
  }
  
  if (presetName.length > 100) {
    throw new Error('Preset name cannot exceed 100 characters.');
  }
}

/**
 * Validates a file path is within the project boundary
 * @param filePath The file path to validate (can be relative or absolute)
 * @param projectRoot The absolute project root path
 * @returns true if the path is safe, false otherwise
 */
export function isPathWithinProject(filePath: string, projectRoot: string): boolean {
  try {
    // If filePath is relative, resolve it relative to projectRoot
    const resolvedPath = path.isAbsolute(filePath) 
      ? path.resolve(filePath)
      : path.resolve(projectRoot, filePath);
    const resolvedRoot = path.resolve(projectRoot);
    
    // Ensure both paths end with separator for accurate comparison
    const normalizedPath = resolvedPath + path.sep;
    const normalizedRoot = resolvedRoot + path.sep;
    
    return normalizedPath.startsWith(normalizedRoot) || resolvedPath === resolvedRoot;
  } catch {
    // If resolution fails, consider it unsafe
    return false;
  }
}