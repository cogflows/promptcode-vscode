import * as https from 'https';

export interface DataIndexEntry {
  name: string;
  category: string[] | string; // Support both array format ["a", "b", "c"] and string format "a/b/c"
  url: string;
  description?: string;
  tags?: string[];
}

/**
 * Fetch the index.json from promptcode-data (no caching).
 */
export async function fetchPromptcodeDataIndex(): Promise<DataIndexEntry[]> {
  const indexUrl = "https://raw.githubusercontent.com/cogflows/promptcode-data/main/content/index.json";
  return new Promise((resolve, reject) => {
    https.get(indexUrl, {
      headers: {
        'User-Agent': 'Node.js HTTPS Client' // GitHub API might require a User-Agent
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        // Consume response data to free up memory
        res.resume();
        return reject(new Error(`Failed to fetch index.json, status code: ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // Basic validation: Check if it's an array
          if (!Array.isArray(json)) {
            reject(new Error('Fetched index data is not an array.'));
          } else {
            resolve(json as DataIndexEntry[]);
          }
        } catch (err) {
          reject(new Error(`Failed to parse index.json: ${(err as Error).message}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`HTTPS request error for index.json: ${err.message}`));
    });
  });
}

/**
 * Fetch the raw content from the given URL (which might be a raw GitHub link).
 */
export async function fetchResourceContent(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Ensure the URL is valid before making the request
    try {
      new URL(url);
    } catch (err) {
      return reject(new Error(`Invalid URL provided: ${url}`));
    }

    https.get(url, {
      headers: {
        'User-Agent': 'Node.js HTTPS Client'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Failed to fetch resource from ${url}, status code: ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(new Error(`HTTPS request error for resource ${url}: ${err.message}`));
    });
  });
} 