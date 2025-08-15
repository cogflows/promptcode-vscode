/**
 * Generate compact Git-style patterns from a file selection.
 * Simple synchronous implementation for backward compatibility.
 * @param selectedPaths Array of selected file paths (relative to workspace root)
 * @param workspaceRoot Absolute path to workspace root
 * @returns Array of patterns that represent the selection
 */
export function generatePatternsFromSelection(
  selectedPaths: string[], 
  workspaceRoot: string
): string[] {
  if (!selectedPaths.length) {
    return [];
  }

  // Convert to posix paths and sort
  const posixPaths = selectedPaths.map(p => p.replace(/\\/g, '/')).sort();
  const patterns: string[] = [];
  const covered = new Set<string>();

  // Group by directory
  const dirGroups = new Map<string, string[]>();
  for (const file of posixPaths) {
    const dir = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '.';
    if (!dirGroups.has(dir)) {
      dirGroups.set(dir, []);
    }
    dirGroups.get(dir)!.push(file);
  }

  // Check for complete directories (minimal optimization)
  for (const [dir, files] of dirGroups.entries()) {
    // For simplicity, we just check if all files in this selection level are included
    // A more sophisticated check would require file system access
    if (files.length >= 3 && dir !== '.') {
      // Heuristic: if we have 3+ files in a dir, use directory pattern
      patterns.push(`${dir}/**`);
      files.forEach(f => covered.add(f));
    }
  }

  // Add remaining individual files
  for (const file of posixPaths) {
    if (!covered.has(file)) {
      patterns.push(file);
    }
  }

  return patterns;
}