import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';
import ignore from 'ignore';
import { SelectedFile } from './types/index.js';
import { countTokensWithCacheDetailed } from './tokenCounter.js';

export interface ScanOptions {
  cwd: string;                    // workspace root
  patterns: string[];             // globs (e.g. ["src/**/*.ts", "!**/*.test.ts"])
  respectGitignore: boolean;
  customIgnoreFile?: string;      // .promptcode_ignore
  workspaceName?: string;         // Name of the workspace
  followSymlinks?: boolean;       // Whether to follow symbolic links (default: false)
  allowImages?: boolean;          // Allow image files (opt-in for multimodal)
}

/**
 * Load ignore patterns from a file
 * @param filePath Path to ignore file
 * @returns Array of patterns
 */
async function loadIgnoreFile(filePath: string): Promise<string[]> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Scan files based on patterns and options
 * @param options Scan options
 * @returns Array of selected files with metadata
 */
export async function scanFiles(options: ScanOptions): Promise<SelectedFile[]> {
  const {
    cwd,
    patterns,
    respectGitignore,
    customIgnoreFile,
    workspaceName = 'workspace',
    followSymlinks = false,
    allowImages = false
  } = options;
  
  // Initialize ignore instance
  const ig = ignore();
  
  // Load .gitignore if needed
  if (respectGitignore) {
    const gitignorePath = path.join(cwd, '.gitignore');
    const gitignorePatterns = await loadIgnoreFile(gitignorePath);
    ig.add(gitignorePatterns);
  }
  
  // Load custom ignore file if provided
  if (customIgnoreFile) {
    const customPatterns = await loadIgnoreFile(customIgnoreFile);
    ig.add(customPatterns);
  }
  
  // Always ignore these patterns (comprehensive security-focused excludes)
  const imageIgnores = [
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.png',
    '**/*.gif',
    '**/*.bmp',
    '**/*.webp',
    '**/*.tiff',
    '**/*.avif',
    '**/*.svg',
  ];

  const defaultIgnores = [
    // Dependencies and version control
    'node_modules/**',
    '.git/**',
    '.svn/**',
    '.hg/**',
    
    // Build outputs
    'dist/**',
    'out/**',
    'build/**',
    '.cache/**',
    
    // IDE and system files
    '.vscode/**',
    '**/.DS_Store',
    
    // Sensitive files and secrets
    '**/.env*',
    '**/*.pem',
    '**/*.key',
    '**/.ssh/**',
    '**/.aws/**',
    '**/.azure/**',
    '**/.gcp/**',
    '**/.kube/**',
    '**/.gnupg/**',
    '**/*.p12',
    '**/*.pfx',
    '**/*.pkcs12',
    '**/*.jks',
    '**/*.keystore',
    '**/*.asc',
    '**/*.enc',
    
    // Databases and backups
    '**/*.sqlite',
    '**/*.db',
    '**/*.bak',
    
    // Archives and media (binary files)
    '**/*.zip',
    '**/*.tar',
    '**/*.tar.gz',
    '**/*.7z',
    '**/*.mp4',
    '**/*.avi',
    '**/*.mov',
    // Images (conditionally excluded)
    ...(allowImages ? [] : imageIgnores),
    
    // Logs
    '**/*.log'
  ];
  ig.add(defaultIgnores);
  
  // Find all files matching patterns
  const files = await fg(patterns, {
    cwd,
    absolute: true,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: followSymlinks,
    ignore: [] // We'll handle ignoring ourselves
  });
  
  // Filter out ignored files
  const filteredFiles = files.filter(file => {
    const relativePath = path.relative(cwd, file);
    return !ig.ignores(relativePath);
  });
  
  // Build SelectedFile objects with token counts
  const selectedFiles: SelectedFile[] = await Promise.all(
    filteredFiles.map(async (absolutePath) => {
      const relativePath = path.relative(cwd, absolutePath);
      const ext = path.extname(absolutePath).toLowerCase();
      const isImage = imageIgnores.some(pattern => pattern.endsWith(ext) || pattern.includes(ext));
      const stat = await fs.promises.stat(absolutePath);
      const tokenCount = isImage ? 0 : (await countTokensWithCacheDetailed(absolutePath)).count;
      const mimeType = (() => {
        switch (ext) {
          case '.png': return 'image/png';
          case '.jpg':
          case '.jpeg': return 'image/jpeg';
          case '.gif': return 'image/gif';
          case '.bmp': return 'image/bmp';
          case '.webp': return 'image/webp';
          case '.tiff': return 'image/tiff';
          case '.avif': return 'image/avif';
          case '.svg': return 'image/svg+xml';
          default: return undefined;
        }
      })();
      
      return {
        path: relativePath,
        absolutePath,
        tokenCount,
        workspaceFolderRootPath: cwd,
        workspaceFolderName: workspaceName,
        isImage,
        mimeType,
        sizeBytes: stat.size
      };
    })
  );
  
  // Sort by path for consistent output
  selectedFiles.sort((a, b) => a.path.localeCompare(b.path));
  
  return selectedFiles;
}
