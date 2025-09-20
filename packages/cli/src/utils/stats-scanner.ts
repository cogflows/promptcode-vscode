/**
 * High-performance file scanner for stats command
 * Based on GPT-5's recommendations for handling 450k+ files efficiently
 */

import * as fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import { countTokensWithCacheDetailed } from '@promptcode/core';
import chalk from 'chalk';
import { shouldShowSpinner } from './environment';

// Set optimal thread pool size for heavy I/O
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(Math.min(32, os.cpus().length * 2));
}

/**
 * Concurrency limiter to prevent resource exhaustion
 */
function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];

  const runNext = () => {
    if (active >= limit || queue.length === 0) {return;}
    const { fn, resolve, reject } = queue.shift()!;
    active++;
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--;
        runNext();
      });
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      runNext();
    });
}

/**
 * Exponentially Weighted Moving Average for smoothing rates
 */
function createEWMA(alpha = 0.2) {
  let value: number | undefined;
  return (x: number) => {
    value = value === null || value === undefined ? x : alpha * x + (1 - alpha) * value;
    return value;
  };
}

/**
 * Format seconds to human-readable time
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) {return '—';}
  if (seconds < 60) {return `${Math.round(seconds)}s`;}
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) {return `${minutes}m ${secs}s`;}
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

/**
 * Format large numbers with locale-specific separators
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Progress tracker with ETA calculation
 */
class ProgressTracker {
  private startTime = performance.now();
  private lastUpdateTime = performance.now();
  private processedCount = 0;
  private errorCount = 0;
  private bytesProcessed = 0;
  private fileRateEWMA = createEWMA(0.2);
  private byteRateEWMA = createEWMA(0.2);
  private lastLogTime = 0;
  private updateInterval = 200; // ms
  private isTTY = process.stderr?.isTTY || false;

  constructor(
    private totalFiles: number,
    private estimatedTotalBytes?: number
  ) {}

  tick(files = 1, bytes = 0, errors = 0) {
    this.processedCount += files;
    this.bytesProcessed += bytes;
    this.errorCount += errors;

    const now = performance.now();
    const deltaTime = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;

    if (deltaTime > 0) {
      this.fileRateEWMA(files / deltaTime);
      if (bytes > 0) {
        this.byteRateEWMA(bytes / deltaTime);
      }
    }

    // Throttle updates
    if (now - this.lastLogTime > this.updateInterval) {
      this.display();
      this.lastLogTime = now;
    }
  }

  display() {
    const filesPerSec = this.fileRateEWMA(0) || 0;
    const bytesPerSec = this.byteRateEWMA(0) || 0;
    const progress = this.processedCount / this.totalFiles;
    const percent = (progress * 100).toFixed(1);

    // Calculate ETA based on both file count and bytes (if available)
    let eta = Infinity;
    if (filesPerSec > 0) {
      const remainingFiles = this.totalFiles - this.processedCount;
      eta = remainingFiles / filesPerSec;
    }

    if (this.estimatedTotalBytes && bytesPerSec > 0) {
      const avgBytesPerFile = this.bytesProcessed / Math.max(1, this.processedCount);
      const estimatedRemainingBytes = avgBytesPerFile * (this.totalFiles - this.processedCount);
      const byteBasedETA = estimatedRemainingBytes / bytesPerSec;
      eta = Math.max(eta, byteBasedETA);
    }

    const etaStr = formatTime(eta);
    const rateStr = `${Math.round(filesPerSec)} files/s`;
    const errorStr = this.errorCount > 0 ? chalk.yellow(` | ${this.errorCount} errors`) : '';

    const message = `Processing... ${formatNumber(this.processedCount)}/${formatNumber(
      this.totalFiles
    )} (${percent}%) | ${rateStr} | ETA ${etaStr}${errorStr}`;

    if (this.isTTY) {
      process.stderr.write(`\r${message}`);
    } else {
      // In non-TTY, print less frequently
      if (this.processedCount % Math.max(1, Math.floor(this.totalFiles / 20)) === 0) {
        console.error(message);
      }
    }
  }

  finish() {
    if (this.isTTY) {
      process.stderr.write('\r' + ' '.repeat(100) + '\r'); // Clear line
    }

    const totalTime = (performance.now() - this.startTime) / 1000;
    const avgRate = this.processedCount / totalTime;

    console.error(chalk.green(`✓ Processed ${formatNumber(this.processedCount)} files in ${formatTime(totalTime)}`));
    if (this.errorCount > 0) {
      console.error(chalk.yellow(`  ⚠ ${this.errorCount} files skipped due to errors`));
    }
    console.error(chalk.gray(`  Average: ${Math.round(avgRate)} files/s`));
  }
}

/**
 * Phase 1: Fast discovery to count files and estimate size
 */
export async function discoverFiles(
  root: string,
  options: {
    dirConcurrency?: number;
    sampleSize?: number;
    respectGitignore?: boolean;
    preset?: string;
    signal?: AbortSignal;
    showProgress?: boolean;
  } = {}
): Promise<{
  totalFiles: number;
  avgBytesPerFile?: number;
  discoveryTime: number;
  aborted: boolean;
}> {
  const startTime = performance.now();
  const { dirConcurrency = 32, sampleSize = 2000, signal, showProgress = true } = options;
  
  const limiter = createLimiter(dirConcurrency);
  let totalFiles = 0;
  let sampledFiles = 0;
  let sampledBytes = 0;
  let dirsProcessed = 0;
  const dirs: string[] = [root];
  const visited = new Set<string>();
  
  // Progress indicator for discovery
  let lastProgressTime = performance.now();
  const progressInterval = 1000; // Update every second
  
  // Common directories to skip for performance
  const skipDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', 'vendor', 'venv', '.venv']);

  async function walkDir(dir: string): Promise<void> {
    if (signal?.aborted) {return;}
    
    // Avoid cycles from symlinks
    try {
      const realPath = await fs.realpath(dir);
      if (visited.has(realPath)) {return;}
      visited.add(realPath);
    } catch {
      return; // Skip if can't resolve
    }

    let dirHandle;
    try {
      dirHandle = await fs.opendir(dir);
    } catch {
      return; // Skip unreadable directories
    }

    try {
      for await (const entry of dirHandle) {
        if (signal?.aborted) {break;}
        
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          // Skip common large directories and symlinks
          if (!skipDirs.has(entry.name)) {
            dirs.push(fullPath);
          }
        } else if (entry.isFile() && !entry.isSymbolicLink()) {
          totalFiles++;
          
          // Sample for size estimation (reservoir sampling for uniform distribution)
          if (sampledFiles < sampleSize) {
            try {
              const stat = await fs.stat(fullPath);
              sampledBytes += stat.size;
              sampledFiles++;
            } catch {
              // Ignore stat errors
            }
          } else if (Math.random() < sampleSize / totalFiles) {
            // Replace random sample to maintain uniform distribution
            try {
              const stat = await fs.stat(fullPath);
              sampledBytes = (sampledBytes / sampledFiles) * (sampledFiles - 1) + stat.size;
            } catch {
              // Ignore stat errors
            }
          }
        }
      }
    } finally {
      await dirHandle.close();
    }
  }

  // Process directories in batches with concurrency control
  while (dirs.length > 0 && !signal?.aborted) {
    const batch = dirs.splice(0, dirConcurrency);
    await Promise.all(batch.map(dir => limiter(() => walkDir(dir))));
    
    dirsProcessed += batch.length;
    
    // Show progress during discovery for large projects
    if (showProgress && process.stderr?.isTTY) {
      const now = performance.now();
      if (now - lastProgressTime > progressInterval) {
        process.stderr.write(
          `\rScanning... ${formatNumber(totalFiles)} files found (${dirsProcessed} directories scanned)`
        );
        lastProgressTime = now;
      }
    }
  }
  
  // Clear progress line
  if (showProgress && process.stderr?.isTTY) {
    process.stderr.write('\r' + ' '.repeat(80) + '\r');
  }

  const avgBytesPerFile = sampledFiles > 0 ? sampledBytes / sampledFiles : undefined;
  const discoveryTime = (performance.now() - startTime) / 1000;

  return {
    totalFiles,
    avgBytesPerFile,
    discoveryTime,
    aborted: signal?.aborted || false
  };
}

/**
 * Phase 2: Process files with token counting
 */
export async function processFiles(
  root: string,
  options: {
    onFile?: (filePath: string) => Promise<{ tokens: number; error?: boolean }>;
    ioConcurrency?: number;
    signal?: AbortSignal;
    progress?: ProgressTracker;
    preset?: string;
  } = {}
): Promise<{
  files: Array<{ path: string; tokens: number; ext: string }>;
  totalTokens: number;
  processedCount: number;
  errorCount: number;
  processingTime: number;
}> {
  const startTime = performance.now();
  const { ioConcurrency = 128, signal, progress } = options;
  const limiter = createLimiter(ioConcurrency);
  
  const files: Array<{ path: string; tokens: number; ext: string }> = [];
  let totalTokens = 0;
  let processedCount = 0;
  let errorCount = 0;
  
  // Skip common directories
  const skipDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', 'vendor', 'venv', '.venv']);
  const visited = new Set<string>();

  // Default file processor if none provided
  const processFile = options.onFile || (async (filePath: string) => {
    try {
      // Skip very large files (>10MB) to avoid hanging
      const stat = await fs.stat(filePath);
      if (stat.size > 10 * 1024 * 1024) {
        // Approximate tokens for large files (roughly 4 chars per token)
        return { tokens: Math.round(stat.size / 4) };
      }
      
      const { count } = await countTokensWithCacheDetailed(filePath);
      return { tokens: count };
    } catch {
      return { tokens: 0, error: true };
    }
  });

  async function walk(dir: string): Promise<void> {
    if (signal?.aborted) {return;}
    
    // Avoid cycles
    try {
      const realPath = await fs.realpath(dir);
      if (visited.has(realPath)) {return;}
      visited.add(realPath);
    } catch {
      return;
    }

    let dirHandle;
    try {
      dirHandle = await fs.opendir(dir);
    } catch {
      return;
    }

    try {
      for await (const entry of dirHandle) {
        if (signal?.aborted) {break;}
        
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          if (!skipDirs.has(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile() && !entry.isSymbolicLink()) {
          await limiter(async () => {
            if (signal?.aborted) {return;}
            
            try {
              const result = await processFile(fullPath);
              const ext = path.extname(fullPath) || '(no extension)';
              
              if (!result.error) {
                files.push({
                  path: path.relative(root, fullPath),
                  tokens: result.tokens,
                  ext
                });
                totalTokens += result.tokens;
                processedCount++;
              } else {
                errorCount++;
              }
              
              progress?.tick(1, 0, result.error ? 1 : 0);
            } catch {
              errorCount++;
              progress?.tick(1, 0, 1);
            }
          });
        }
      }
    } finally {
      await dirHandle.close();
    }
  }

  await walk(root);
  
  // Wait for all pending operations
  await limiter(() => Promise.resolve());
  
  const processingTime = (performance.now() - startTime) / 1000;
  
  return {
    files,
    totalTokens,
    processedCount,
    errorCount,
    processingTime
  };
}

/**
 * Main stats runner with two-phase approach
 */
export async function runStats(
  projectPath: string,
  options: {
    preset?: string;
    json?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<void> {
  const { preset, json, signal } = options;
  
  // Phase 1: Discovery
  if (!json) {
    console.error(chalk.cyan('Scanning file tree...'));
  }
  
  const discovery = await discoverFiles(projectPath, {
    preset,
    signal,
    sampleSize: Math.min(2000, 100), // Sample for size estimation
    dirConcurrency: 32
  });
  
  if (discovery.aborted) {
    console.error(chalk.yellow('\n✗ Scan aborted by user'));
    process.exit(130);
  }
  
  if (discovery.totalFiles === 0) {
    if (json) {
      console.log(JSON.stringify({
        project: path.basename(projectPath),
        preset: preset || null,
        totalFiles: 0,
        totalTokens: 0,
        message: 'No files found'
      }, null, 2));
    } else {
      console.error(chalk.yellow('No files found to analyze'));
    }
    return;
  }
  
  // Estimate time based on file count and average size
  const estimatedSeconds = discovery.avgBytesPerFile 
    ? Math.ceil((discovery.totalFiles * discovery.avgBytesPerFile) / (50 * 1024 * 1024)) // Assume 50MB/s
    : Math.ceil(discovery.totalFiles / 1000); // Assume 1000 files/s
  
  if (!json) {
    console.error(
      chalk.green(`✓ Found ${formatNumber(discovery.totalFiles)} files`) +
      chalk.gray(` (${formatTime(discovery.discoveryTime)})`));
    
    if (discovery.totalFiles > 10000) {
      console.error(
        chalk.yellow(`\nThis is a large project. Estimated time: ~${formatTime(estimatedSeconds)}`) +
        chalk.gray('\nWe\'ll refine the estimate as we go...\n')
      );
    }
  }
  
  // Phase 2: Processing with progress
  const progress = !json && shouldShowSpinner() 
    ? new ProgressTracker(discovery.totalFiles, discovery.avgBytesPerFile ? discovery.totalFiles * discovery.avgBytesPerFile : undefined)
    : undefined;
  
  const processing = await processFiles(projectPath, {
    preset,
    signal,
    progress,
    ioConcurrency: 32 // Reduced concurrency to avoid overwhelming the system
  });
  
  progress?.finish();
  
  if (signal?.aborted) {
    console.error(chalk.yellow('\n✗ Processing aborted by user'));
    process.exit(130);
  }
  
  // Calculate statistics by file type
  const filesByExt: Record<string, { count: number; tokens: number }> = {};
  for (const file of processing.files) {
    if (!filesByExt[file.ext]) {
      filesByExt[file.ext] = { count: 0, tokens: 0 };
    }
    filesByExt[file.ext].count++;
    filesByExt[file.ext].tokens += file.tokens;
  }
  
  const sortedExts = Object.entries(filesByExt)
    .sort((a, b) => b[1].tokens - a[1].tokens);
  
  // Output results
  if (json) {
    const output = {
      project: path.basename(projectPath),
      preset: preset || null,
      totalFiles: processing.processedCount,
      totalTokens: processing.totalTokens,
      averageTokensPerFile: processing.processedCount > 0 
        ? Math.round(processing.totalTokens / processing.processedCount) 
        : 0,
      fileTypes: sortedExts.slice(0, 20).map(([ext, stats]) => ({
        extension: ext,
        fileCount: stats.count,
        tokenCount: stats.tokens,
        percentage: processing.totalTokens > 0 
          ? parseFloat(((stats.tokens / processing.totalTokens) * 100).toFixed(2))
          : 0
      })),
      topFiles: processing.files
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 10)
        .map(f => ({
          path: f.path,
          tokens: f.tokens
        })),
      performance: {
        discoveryTime: discovery.discoveryTime,
        processingTime: processing.processingTime,
        totalTime: discovery.discoveryTime + processing.processingTime,
        filesPerSecond: Math.round(processing.processedCount / (discovery.discoveryTime + processing.processingTime))
      },
      errors: processing.errorCount
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Display human-readable results
    const title = preset 
      ? `Preset Statistics: ${chalk.cyan(preset)}`
      : `Project Statistics: ${chalk.cyan(path.basename(projectPath))}`;
    
    console.log(chalk.bold(`\n${title}`));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Total files: ${chalk.cyan(formatNumber(processing.processedCount))}`);
    console.log(`Total tokens: ${chalk.cyan(formatNumber(processing.totalTokens))}`);
    
    if (processing.processedCount > 0) {
      console.log(`Average tokens/file: ${chalk.cyan(formatNumber(Math.round(processing.totalTokens / processing.processedCount)))}`);
    }
    
    if (sortedExts.length > 0) {
      console.log(chalk.bold('\nTop file types by token count:'));
      const topExts = sortedExts.slice(0, 10);
      
      for (const [ext, stats] of topExts) {
        const percentage = processing.totalTokens > 0 
          ? ((stats.tokens / processing.totalTokens) * 100).toFixed(1)
          : '0.0';
        console.log(
          `  ${ext.padEnd(15)} ${chalk.cyan(stats.count.toString().padStart(5))} files  ` +
          `${chalk.cyan(formatNumber(stats.tokens).padStart(10))} tokens  ${chalk.gray(`(${percentage}%)`)}`
        );
      }
    }
    
    // Performance summary
    console.log(chalk.bold('\nPerformance:'));
    console.log(`  Discovery: ${chalk.gray(formatTime(discovery.discoveryTime))}`);
    console.log(`  Processing: ${chalk.gray(formatTime(processing.processingTime))}`);
    console.log(`  Total time: ${chalk.gray(formatTime(discovery.discoveryTime + processing.processingTime))}`);
    
    const overallRate = processing.processedCount / (discovery.discoveryTime + processing.processingTime);
    console.log(`  Average: ${chalk.gray(`${Math.round(overallRate)} files/s`)}`);
  }
}