import * as path from 'path';
import * as fs from 'fs';
import { clearTokenCache, getCacheStats, initializeTokenCounter } from '@promptcode/core';
import chalk from 'chalk';

export interface CacheOptions {
  stats?: boolean;
}

/**
 * Cache command implementation
 * @param action Cache action (clear, stats)
 * @param options Command options
 */
export async function cacheCommand(action: string, options: CacheOptions): Promise<void> {
  // Initialize token counter
  const cacheDir = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '', '.cache', 'promptcode');
  initializeTokenCounter(cacheDir, '0.1.0');
  
  switch (action) {
    case 'clear':
      clearTokenCache();
      console.log(chalk.green('✓ Token cache cleared'));
      break;
      
    case 'stats':
      const stats = getCacheStats();
      console.log(chalk.bold('Token Cache Statistics:'));
      console.log(chalk.gray('─'.repeat(30)));
      console.log(`Current size: ${chalk.cyan(stats.size)} files`);
      console.log(`Maximum size: ${chalk.cyan(stats.maxSize)} files`);
      console.log(`Hit rate: ${chalk.cyan((stats.hitRate * 100).toFixed(1))}%`);
      console.log(`Cache location: ${chalk.gray(cacheDir)}`);
      
      // Check disk cache size
      const cachePath = path.join(cacheDir, 'promptcode-token-cache.json');
      if (fs.existsSync(cachePath)) {
        const stat = fs.statSync(cachePath);
        const sizeKB = (stat.size / 1024).toFixed(2);
        console.log(`Disk cache size: ${chalk.cyan(sizeKB)} KB`);
      }
      break;
      
    default:
      console.error(chalk.red(`Unknown cache action: ${action}`));
      console.log('Available actions: clear, stats');
      process.exit(1);
  }
}