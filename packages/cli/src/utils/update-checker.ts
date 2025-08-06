import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getCacheDir } from './paths';
import { BUILD_VERSION } from '../version';

const REPO = 'cogflows/promptcode-vscode';
const UPDATE_CHECK_INTERVAL = 1000 * 60 * 60 * 24; // 24 hours
const UPDATE_CHECK_FILE = 'update-check.json';

interface UpdateCache {
  lastCheck: number;
  latestVersion?: string;
  etag?: string;
}

async function fetchLatestVersion(etag?: string): Promise<{ version: string | null; newEtag?: string }> {
  try {
    const headers: HeadersInit = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }
    
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers }
    );
    
    // 304 Not Modified - no new version
    if (response.status === 304) {
      return { version: null };
    }
    
    if (!response.ok) {
      return { version: null };
    }
    
    const data = await response.json();
    const newEtag = response.headers.get('etag') || undefined;
    
    return { 
      version: data.tag_name,
      newEtag
    };
  } catch {
    // Silently fail on network errors
    return { version: null };
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  try {
    const latestParts = latest.replace(/^v/, '').split('.').map(Number);
    const currentParts = current.replace(/^v/, '').split('.').map(Number);
    
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const latestPart = latestParts[i] || 0;
      const currentPart = currentParts[i] || 0;
      
      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }
    
    return false;
  } catch {
    return latest !== current;
  }
}

async function readUpdateCache(): Promise<UpdateCache | null> {
  try {
    const cachePath = path.join(getCacheDir(), UPDATE_CHECK_FILE);
    const content = await fs.readFile(cachePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeUpdateCache(cache: UpdateCache): Promise<void> {
  try {
    const cacheDir = getCacheDir();
    await fs.mkdir(cacheDir, { recursive: true });
    
    const cachePath = path.join(cacheDir, UPDATE_CHECK_FILE);
    const tempPath = `${cachePath}.tmp.${process.pid}`;
    
    // Write to temp file first (atomic write pattern)
    await fs.writeFile(tempPath, JSON.stringify(cache, null, 2), { mode: 0o644 });
    
    // Atomically rename temp file to final location
    // This prevents partial writes and race conditions
    await fs.rename(tempPath, cachePath);
  } catch {
    // Silently fail if we can't write cache
    // Clean up temp file if it exists
    try {
      const tempPath = `${path.join(getCacheDir(), UPDATE_CHECK_FILE)}.tmp.${process.pid}`;
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Start an async update check that will show a message at program exit if update available
 * This runs non-blocking in the background while the CLI does its work
 */
export function startUpdateCheck(): void {
  // Skip in test/CI environments
  if (process.env.NODE_ENV === 'test' || process.env.CI || process.env.PROMPTCODE_TEST) {
    return;
  }
  
  // Skip for development builds
  if (BUILD_VERSION.includes('-dev') || BUILD_VERSION === '0.0.0-dev') {
    return;
  }
  
  // Skip if explicitly disabled
  if (process.env.PROMPTCODE_NO_UPDATE_CHECK === '1') {
    return;
  }
  
  // Run the check async - don't await
  performAsyncUpdateCheck().catch(() => {
    // Silently ignore errors
  });
}

async function performAsyncUpdateCheck(): Promise<void> {
  try {
    // Read cache
    const cache = await readUpdateCache();
    const now = Date.now();
    
    // Check if we should check for updates
    if (cache && (now - cache.lastCheck) < UPDATE_CHECK_INTERVAL) {
      // Not time to check yet, but check if we have a cached update to show
      if (cache.latestVersion && isNewerVersion(cache.latestVersion, BUILD_VERSION)) {
        // Register to show message on exit
        registerExitMessage(cache.latestVersion);
      }
      return;
    }
    
    // Perform the actual update check
    const { version: latestVersion, newEtag } = await fetchLatestVersion(cache?.etag);
    
    // Update cache
    const newCache: UpdateCache = {
      lastCheck: Date.now(),
      latestVersion: latestVersion || undefined,
      etag: newEtag
    };
    
    await writeUpdateCache(newCache);
    
    // If newer version available, register to show on exit
    if (latestVersion && isNewerVersion(latestVersion, BUILD_VERSION)) {
      registerExitMessage(latestVersion);
    }
  } catch {
    // Silently fail
  }
}

// Store the update message to show on exit
let pendingUpdateMessage: string | null = null;

function registerExitMessage(latestVersion: string): void {
  pendingUpdateMessage = latestVersion;
  
  // Register exit handler if not already registered
  if (!process.listenerCount('beforeExit')) {
    process.on('beforeExit', showPendingUpdateMessage);
    process.on('exit', showPendingUpdateMessage);
  }
}

function showPendingUpdateMessage(): void {
  if (pendingUpdateMessage) {
    console.error(''); // Use stderr to not interfere with stdout
    console.error(chalk.bgYellow.black(' UPDATE AVAILABLE '));
    console.error(
      chalk.yellow(`A new version of PromptCode CLI is available: ${chalk.green(pendingUpdateMessage)}`)
    );
    console.error(
      chalk.yellow(`You are currently on version ${chalk.red(BUILD_VERSION)}`)
    );
    console.error('');
    console.error('Update with:');
    console.error(chalk.cyan('  promptcode self-update'));
    console.error('');
    
    // Clear the message so it doesn't show twice
    pendingUpdateMessage = null;
  }
}