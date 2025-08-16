import * as https from 'https';

export interface DataIndexEntry {
  name: string;
  category: string[] | string; // Support both array format ["a", "b", "c"] and string format "a/b/c"
  url: string;
  description?: string;
  tags?: string[];
}

// In-memory cache for the session
interface CacheEntry {
  data: any;
  timestamp: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
const REQUEST_TIMEOUT = 8000; // 8 seconds timeout

/**
 * Make an HTTPS request with timeout and caching support
 */
async function fetchWithTimeout(url: string, options: { 
  useCache?: boolean; 
  parseJson?: boolean;
} = {}): Promise<any> {
  const { useCache = true, parseJson = false } = options;
  
  // Check cache first
  if (useCache && cache.has(url)) {
    const cached = cache.get(url)!;
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  return new Promise((resolve, reject) => {
    // Validate URL
    try {
      new URL(url);
    } catch (err) {
      return reject(new Error(`Invalid URL provided: ${url}`));
    }

    const timeoutId = setTimeout(() => {
      reject(new Error(`Request timeout for ${url}`));
    }, REQUEST_TIMEOUT);

    const req = https.get(url, {
      headers: {
        'User-Agent': 'Node.js HTTPS Client' // GitHub API might require a User-Agent
      }
    }, (res) => {
      clearTimeout(timeoutId);
      
      if (res.statusCode !== 200) {
        // Consume response data to free up memory
        res.resume();
        return reject(new Error(`Failed to fetch ${url}, status code: ${res.statusCode}`));
      }
      
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = parseJson ? JSON.parse(data) : data;
          
          // Cache the result
          if (useCache) {
            cache.set(url, {
              data: result,
              timestamp: Date.now(),
              etag: res.headers.etag
            });
          }
          
          resolve(result);
        } catch (err) {
          reject(new Error(`Failed to parse response from ${url}: ${(err as Error).message}`));
        }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`HTTPS request error for ${url}: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout for ${url}`));
    });
  });
}

/**
 * Fetch the index.json from promptcode-data with caching.
 */
export async function fetchPromptcodeDataIndex(): Promise<DataIndexEntry[]> {
  const indexUrl = "https://raw.githubusercontent.com/cogflows/promptcode-data/main/content/index.json";
  
  try {
    const json = await fetchWithTimeout(indexUrl, { parseJson: true });
    
    // Basic validation: Check if it's an array
    if (!Array.isArray(json)) {
      throw new Error('Fetched index data is not an array.');
    }
    
    return json as DataIndexEntry[];
  } catch (err) {
    // Try to return cached data if available (even if expired) when network fails
    if (cache.has(indexUrl)) {
      const cached = cache.get(indexUrl)!;
      if (Array.isArray(cached.data)) {
        return cached.data as DataIndexEntry[];
      }
    }
    throw err;
  }
}

/**
 * Fetch the raw content from the given URL (which might be a raw GitHub link) with caching.
 */
export async function fetchResourceContent(url: string): Promise<string> {
  try {
    return await fetchWithTimeout(url, { parseJson: false });
  } catch (err) {
    // Try to return cached data if available (even if expired) when network fails
    if (cache.has(url)) {
      const cached = cache.get(url)!;
      if (typeof cached.data === 'string') {
        return cached.data;
      }
    }
    throw err;
  }
}

/**
 * Clear the cache (useful for testing or manual refresh)
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: cache.size,
    entries: Array.from(cache.keys())
  };
}