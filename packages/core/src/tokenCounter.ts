import * as fs from 'fs';
import * as path from 'path';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import createDebug from 'debug';

// Create debug namespace for token counter
const debug = createDebug('promptcode:tokenCounter');

// Interface for cache entries
interface TokenCacheEntry {
  count: number;
  sha256: string;      // Content hash for accurate validation
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
    
    stream.on('data', (chunk) => {
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
 * Initialize the token counter with a cache directory
 * @param cacheDir Directory to store the disk cache
 * @param version Version string for cache invalidation
 */
export function initializeTokenCounter(cacheDir: string, version?: string): void {
  diskCachePath = path.join(cacheDir, 'promptcode-token-cache.json');
  extensionVersion = version || '0.0.0';
  loadDiskCache();
}

/**
 * Load cache from disk
 */
function loadDiskCache(): void {
  if (!diskCachePath) {return;}
  
  try {
    if (fs.existsSync(diskCachePath)) {
      const data = fs.readFileSync(diskCachePath, 'utf8');
      const diskCache: DiskCache = JSON.parse(data);
      
      // Check cache version compatibility
      if (diskCache.version === '1.0' && diskCache.extensionVersion === extensionVersion) {
        // Load entries into memory cache
        for (const [key, entry] of Object.entries(diskCache.entries)) {
          tokenCache.set(key, entry);
        }
        debug(`Loaded ${Object.keys(diskCache.entries).length} entries from disk cache`);
      } else {
        debug('Cache version mismatch, starting fresh');
      }
    }
  } catch (error) {
    debug('Error loading disk cache:', error);
  }
}

/**
 * Save cache to disk (debounced)
 */
function scheduleCacheSave(): void {
  if (!diskCachePath) {return;}
  
  // Clear existing timer
  if (saveCacheTimer) {
    clearTimeout(saveCacheTimer);
  }
  
  // Schedule new save
  saveCacheTimer = setTimeout(() => {
    saveCacheToDisk();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Immediately save cache to disk
 */
export function saveCacheToDisk(): void {
  if (!diskCachePath) {return;}
  
  try {
    const entries: Record<string, TokenCacheEntry> = {};
    
    // Extract all entries from LRU cache
    for (const [key, value] of tokenCache.entries()) {
      entries[key] = value;
    }
    
    const diskCache: DiskCache = {
      version: '1.0',
      extensionVersion: extensionVersion || '0.0.0',
      entries,
      lastUpdated: Date.now()
    };
    
    // Ensure directory exists
    const dir = path.dirname(diskCachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write atomically using a temp file
    const tempPath = `${diskCachePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(diskCache, null, 2));
    fs.renameSync(tempPath, diskCachePath);
    
    debug(`Saved ${Object.keys(entries).length} entries to disk cache`);
  } catch (error) {
    debug('Error saving disk cache:', error);
  }
}

/**
 * Count tokens in a file with caching
 * @param filePath Absolute path to the file
 * @returns Token count
 */
export async function countTokensInFile(filePath: string): Promise<number> {
  try {
    const stat = await fs.promises.stat(filePath);
    
    // Check if file is binary
    const isBinary = await checkIfBinary(filePath);
    if (isBinary) {
      debug(`Skipping binary file: ${filePath}`);
      return 0; // Binary files don't contribute tokens
    }
    
    // Check cache first
    const cached = tokenCache.get(filePath);
    if (cached && cached.mtime === stat.mtime.getTime() && cached.size === stat.size) {
      // Validate content hash for extra safety
      const currentHash = await computeFileHash(filePath);
      if (currentHash === cached.sha256) {
        return cached.count;
      }
      debug(`Hash mismatch for ${filePath}, recalculating...`);
    }
    
    // Read file and count tokens
    const content = await fs.promises.readFile(filePath, 'utf8');
    const tokenCount = countTokens(content);
    
    // Compute content hash
    const sha256 = await computeFileHash(filePath);
    
    // Update cache
    const entry: TokenCacheEntry = {
      count: tokenCount,
      sha256,
      mtime: stat.mtime.getTime(),
      size: stat.size,
      timestamp: Date.now()
    };
    
    tokenCache.set(filePath, entry);
    scheduleCacheSave();
    
    return tokenCount;
  } catch (error) {
    debug(`Error counting tokens in ${filePath}:`, error);
    return 0;
  }
}

/**
 * Count tokens with cache, returning detailed information
 * @param filePath Absolute path to the file
 * @returns Object with token count and cache hit status
 */
export async function countTokensWithCacheDetailed(filePath: string): Promise<{ count: number; cacheHit: boolean }> {
  try {
    const stat = await fs.promises.stat(filePath);
    
    // Check if file is binary
    const isBinary = await checkIfBinary(filePath);
    if (isBinary) {
      return { count: 0, cacheHit: true }; // Consider binary files as cached with 0 tokens
    }
    
    // Check cache first
    const cached = tokenCache.get(filePath);
    if (cached && cached.mtime === stat.mtime.getTime() && cached.size === stat.size) {
      // Validate content hash
      const currentHash = await computeFileHash(filePath);
      if (currentHash === cached.sha256) {
        return { count: cached.count, cacheHit: true };
      }
    }
    
    // Cache miss - read and count
    const content = await fs.promises.readFile(filePath, 'utf8');
    const tokenCount = countTokens(content);
    
    // Compute content hash
    const sha256 = await computeFileHash(filePath);
    
    // Update cache
    const entry: TokenCacheEntry = {
      count: tokenCount,
      sha256,
      mtime: stat.mtime.getTime(),
      size: stat.size,
      timestamp: Date.now()
    };
    
    tokenCache.set(filePath, entry);
    scheduleCacheSave();
    
    return { count: tokenCount, cacheHit: false };
  } catch (error) {
    debug(`Error counting tokens in ${filePath}:`, error);
    return { count: 0, cacheHit: false };
  }
}

/**
 * Count tokens with simple caching
 * @param filePath Absolute path to the file
 * @returns Token count
 */
export async function countTokensWithCache(filePath: string): Promise<number> {
  const result = await countTokensWithCacheDetailed(filePath);
  return result.count;
}

/**
 * Clear the token cache
 */
export function clearTokenCache(): void {
  tokenCache.clear();
  debug('Cache cleared');
  
  // Also clear disk cache
  if (diskCachePath && fs.existsSync(diskCachePath)) {
    try {
      fs.unlinkSync(diskCachePath);
      debug('Disk cache cleared');
    } catch (error) {
      debug('Error clearing disk cache:', error);
    }
  }
}

/**
 * Remove a specific file from the cache
 * @param filePath Absolute path to the file
 */
export function invalidateCacheEntry(filePath: string): void {
  if (tokenCache.delete(filePath)) {
    scheduleCacheSave();
  }
}

/**
 * Get cache statistics
 * @returns Object with cache statistics
 */
export function getCacheStats(): { size: number; maxSize: number; hitRate: number } {
  const size = tokenCache.size;
  const maxSize = tokenCache.max;
  
  // Calculate hit rate (simplified - would need to track hits/misses for accurate rate)
  const hitRate = size > 0 ? size / maxSize : 0;
  
  return { size, maxSize, hitRate };
}

// Export tokenizer function for direct use
export { countTokens };