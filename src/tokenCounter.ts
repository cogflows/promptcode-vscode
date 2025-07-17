import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';


// Interface for cache entries
interface TokenCacheEntry {
  count: number;
  sha256: string;      // NEW: Content hash for accurate validation
  mtime: number;
  size: number;
  timestamp: number;
}

// Structure for the disk cache file
interface DiskCache {
  version: string;
  extensionVersion: string;
  entries: Record<string, TokenCacheEntry>;
  lastUpdated: number;
}

// Cache for token counts to avoid recalculating
// Export for FileSystemWatcher access in extension.ts
export const tokenCache = new LRUCache<string, TokenCacheEntry>({
  max: 10_000,          // Maximum 10k files (approx few MB)
  // No TTL needed - FileSystemWatcher + SHA-256 hash ensure correctness
});

// Path to the disk cache file
let diskCachePath: string | undefined;

// Extension version
let extensionVersion: string | undefined;

// Save debounce timer
let saveCacheTimer: NodeJS.Timeout | null = null;
const SAVE_DEBOUNCE_MS = 5000; // Save at most once every 5 seconds

/**
 * Compute SHA-256 hash of a file using streaming for memory efficiency
 * @param filePath Path to the file
 * @returns SHA-256 hash as hex string
 */
async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('data', data => hash.update(data))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Check if a file is likely binary by examining its content
 * @param filePath Path to the file
 * @returns True if file appears to be binary
 */
async function checkIfBinary(filePath: string): Promise<boolean> {
  // Common binary file extensions
  const binaryExtensions = new Set([
    '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.obj', '.class',
    '.pkl', '.h5', '.model', '.pb', '.onnx', '.npy', '.npz',
    '.pyc', '.pyo', '.pyd', '.db', '.sqlite', '.sqlite3',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp',
    '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
    '.mp3', '.mp4', '.avi', '.mov', '.mkv',
    '.ttf', '.otf', '.woff', '.woff2', '.eot'
  ]);
  
  // Check file extension first
  const ext = path.extname(filePath).toLowerCase();
  if (binaryExtensions.has(ext)) {
    return true;
  }
  
  // Check first 8KB for null bytes (common in binary files)
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { start: 0, end: 8191 });
    let isBinary = false;
    
    stream.on('data', (chunk: Buffer) => {
      // Check for null bytes
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0) {
          isBinary = true;
          stream.destroy();
          break;
        }
      }
    });
    
    stream.on('end', () => resolve(isBinary));
    stream.on('error', () => resolve(false)); // Assume text on error
    stream.on('close', () => resolve(isBinary));
  });
}

/**
 * Initialize the token counter with a storage path
 * @param globalStoragePath The extension's global storage path
 */
export function initializeTokenCounter(globalStoragePath: string): void {
  // Ensure the storage directory exists
  if (!fs.existsSync(globalStoragePath)) {
    fs.mkdirSync(globalStoragePath, { recursive: true });
  }
  
  diskCachePath = path.join(globalStoragePath, 'token-cache.json');
  console.log(`Token cache will be stored at: ${diskCachePath}`);
  
  // Get extension version
  try {
    const extension = vscode.extensions.getExtension('promptcode');
    if (extension) {
      extensionVersion = extension.packageJSON.version;
      console.log(`Extension version: ${extensionVersion}`);
    } else {
      // Try to find the extension by inferring the publisher
      const allExtensions = vscode.extensions.all;
      for (const ext of allExtensions) {
        if (ext.id.toLowerCase().endsWith('.promptcode')) {
          extensionVersion = ext.packageJSON.version;
          console.log(`Found extension version: ${extensionVersion}`);
          break;
        }
      }
      if (!extensionVersion) {
        console.warn('Could not determine extension version, cache version validation will be disabled');
      }
    }
  } catch (error) {
    console.warn('Error getting extension version:', error);
  }
  
  loadCacheFromDisk().catch(err => {
    console.error('Failed to load token cache from disk:', err);
  });
}

/**
 * Counts the number of tokens in a file using gpt-tokenizer
 * @param filePath Path to the file
 * @returns Number of tokens in the file
 */
export async function countTokensInFile(filePath: string): Promise<number> {
    try {
        // Check if file exists and is readable
        await fs.promises.access(filePath, fs.constants.R_OK);
        
        // Read file content
        const content = await fs.promises.readFile(filePath, 'utf8');
        
        // Count tokens using gpt-tokenizer
        const tokenCount = countTokens(content);
        
        return tokenCount;
    } catch (error) {
        console.error(`Error counting tokens in file ${filePath}:`, error);
        return 0;
    }
}

/**
 * Checks if a cached count for a file is still valid
 * @param filePath Path to the file
 * @param stats File stats
 * @returns True if cache is valid, false otherwise
 */
function isCacheValid(filePath: string, stats: fs.Stats): boolean {
    const cached = tokenCache.get(filePath);
    if (!cached) {
        return false;
    }
    
    // Check if file modification time or size has changed
    return cached.mtime === stats.mtimeMs && cached.size === stats.size;
}

/**
 * Result of token counting with cache status
 */
export interface TokenCountResult {
    count: number;
    cacheHit: boolean;
}

/**
 * Counts tokens in a file with caching based on content hash
 * @param filePath Path to the file
 * @returns Number of tokens in the file
 */
export async function countTokensWithCache(filePath: string): Promise<number> {
    const result = await countTokensWithCacheDetailed(filePath);
    return result.count;
}

/**
 * Counts tokens in a file with caching, returning cache hit status
 * @param filePath Path to the file
 * @returns Token count and cache hit status
 */
export async function countTokensWithCacheDetailed(filePath: string): Promise<TokenCountResult> {
    const startTime = Date.now();
    
    try {
        // Check cache FIRST - avoid all I/O if possible
        const cached = tokenCache.get(filePath);
        if (cached) {
            // Cache hit! Since FileSystemWatcher invalidates on changes,
            // we can trust this entry completely
            const elapsed = Date.now() - startTime;
            if (elapsed > 1) { // Only log slow cache hits
                console.log(`[TokenCache] Cache hit for ${path.basename(filePath)} (${elapsed}ms)`);
            }
            return { count: cached.count, cacheHit: true };
        }

        // Cache miss - need to compute
        console.log(`[TokenCache] Cache miss for ${path.basename(filePath)}`);
        
        const stats = await fs.promises.stat(filePath);
        
        // Check file size limit (10MB)
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        if (stats.size > MAX_FILE_SIZE) {
            console.warn(`[TokenCache] File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB): ${path.basename(filePath)}`);
            // Store a zero count for large files to avoid reprocessing
            tokenCache.set(filePath, { 
                count: 0, 
                sha256: 'too-large',
                mtime: stats.mtimeMs,
                size: stats.size,
                timestamp: Date.now() 
            });
            return { count: 0, cacheHit: false };
        }
        
        // Check if file is likely binary before trying to read as text
        const isBinary = await checkIfBinary(filePath);
        if (isBinary) {
            console.log(`[TokenCache] Binary file detected: ${path.basename(filePath)}`);
            // Store a zero count for binary files
            tokenCache.set(filePath, { 
                count: 0, 
                sha256: 'binary-file',
                mtime: stats.mtimeMs,
                size: stats.size,
                timestamp: Date.now() 
            });
            return { count: 0, cacheHit: false };
        }
        
        const sha = await computeFileHash(filePath);
        
        // Check if we had a stale entry (shouldn't happen with FileSystemWatcher)
        const staleEntry = tokenCache.get(filePath);
        if (staleEntry) {
            console.warn(`[TokenCache] Found stale entry for ${path.basename(filePath)} - FileSystemWatcher may have missed a change`);
        }

        // Read file and count tokens
        const content = await fs.promises.readFile(filePath, 'utf8');
        const count = countTokens(content);
        
        // Store in cache
        tokenCache.set(filePath, { 
            count, 
            sha256: sha,
            mtime: stats.mtimeMs,
            size: stats.size,
            timestamp: Date.now() 
        });
        
        scheduleCacheSave();
        
        const elapsed = Date.now() - startTime;
        console.log(`[TokenCache] Computed tokens for ${path.basename(filePath)}: ${count} tokens (${elapsed}ms)`);
        
        return { count, cacheHit: false };
    } catch (error) {
        console.error(`[TokenCache] Error for file ${filePath}:`, error);
        
        // If there's an error, try direct counting
        try {
            const count = await countTokensInFile(filePath);
            return { count, cacheHit: false };
        } catch (innerError) {
            console.error(`[TokenCache] Failed fallback for ${filePath}:`, innerError);
            return { count: 0, cacheHit: false };
        }
    }
}

/**
 * Schedule saving the cache to disk in a debounced manner
 */
function scheduleCacheSave(): void {
  if (saveCacheTimer) {
    clearTimeout(saveCacheTimer);
  }
  
  saveCacheTimer = setTimeout(() => {
    saveCacheToDisk().catch(err => {
      console.error('Failed to save token cache to disk:', err);
    });
    saveCacheTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Save the current memory cache to disk
 */
async function saveCacheToDisk(): Promise<void> {
  if (!diskCachePath) {
    console.warn('No disk cache path set, cannot save token cache');
    return;
  }
  
  try {
    // Create directory if it doesn't exist
    const cacheDir = path.dirname(diskCachePath);
    await fs.promises.mkdir(cacheDir, { recursive: true });
    
    // Convert the LRU cache to a Record for JSON serialization
    const entries: Record<string, TokenCacheEntry> = {};
    for (const [key, value] of tokenCache.entries()) {
      entries[key] = value;
    }
    
    // Create cache data structure
    const cacheData: DiskCache = {
      version: '1.0',
      extensionVersion: extensionVersion || '0.0.0',
      entries,
      lastUpdated: Date.now()
    };
    
    // Write to disk
    await fs.promises.writeFile(
      diskCachePath, 
      JSON.stringify(cacheData, null, 2), 
      'utf8'
    );
    
    console.log(`Token cache saved to disk (${Object.keys(entries).length} entries)`);
  } catch (error) {
    console.error('Error saving token cache to disk:', error);
    throw error;
  }
}

/**
 * Load the cache from disk
 */
async function loadCacheFromDisk(): Promise<void> {
  if (!diskCachePath) {
    console.warn('No disk cache path set, cannot load token cache');
    return;
  }
  
  try {
    // Check if cache file exists
    await fs.promises.access(diskCachePath, fs.constants.R_OK);
    
    // Read and parse cache file
    const cacheContent = await fs.promises.readFile(diskCachePath, 'utf8');
    const cacheData = JSON.parse(cacheContent) as DiskCache;
    
    // Validate cache version and extension version
    if (cacheData.version === '1.0') {
      // Check if extension version matches or if we should invalidate the cache
      if (!cacheData.extensionVersion || !extensionVersion || 
          cacheData.extensionVersion !== extensionVersion) {
        console.log(`Extension version mismatch or missing (cache: ${cacheData.extensionVersion}, current: ${extensionVersion}). Invalidating cache.`);
        // Clear the current cache - we won't load anything
        tokenCache.clear();
        return;
      }
      
      // Clear current cache
      tokenCache.clear();
      
      // Load entries into memory cache
      let loadedCount = 0;
      let skippedCount = 0;
      Object.entries(cacheData.entries).forEach(([filePath, entry]) => {
        // Only import entries for files that still exist and have sha256
        if (fs.existsSync(filePath)) {
          // Check if entry has sha256 field (backward compatibility)
          if ('sha256' in entry && entry.sha256) {
            tokenCache.set(filePath, entry);
            loadedCount++;
          } else {
            // Skip entries without sha256 to ensure cache consistency
            skippedCount++;
          }
        }
      });
      
      if (skippedCount > 0) {
        console.log(`Skipped ${skippedCount} cache entries without sha256 hash`);
      }
      
      console.log(`Loaded ${loadedCount} token cache entries from disk`);
    } else {
      console.warn(`Unsupported token cache version: ${cacheData.version}`);
    }
  } catch (error) {
    // Ignore if file doesn't exist yet
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.log('No token cache file found, starting with empty cache');
    } else {
      console.error('Error loading token cache from disk:', error);
      throw error;
    }
  }
}

/**
 * Clears the token cache (both memory and disk)
 */
export function clearTokenCache(): void {
    // Clear memory cache
    tokenCache.clear();
    console.log('Token cache cleared from memory');
    
    // Clear disk cache if available
    if (diskCachePath) {
      fs.unlink(diskCachePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('Error deleting token cache file:', err);
        } else {
          console.log('Token cache file deleted from disk');
        }
      });
    }
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
  const size = tokenCache.size;
  const maxSize = tokenCache.max;
  
  console.log(`[TokenCache] Current cache stats: ${size}/${maxSize} entries`);
  
  return {
    size,
    maxSize
  };
} 