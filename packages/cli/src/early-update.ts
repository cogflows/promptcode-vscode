/**
 * Early update finalization module
 * 
 * This module handles the atomic finalization of pending CLI updates.
 * It must be called at the very beginning of the CLI entry point,
 * before any other initialization or imports that might hold resources.
 * 
 * Key features:
 * - Atomic binary replacement with rollback capability
 * - Exclusive locking to prevent concurrent updates
 * - Proper signal and exit code propagation
 * - Symlink-aware operation
 * - Permission preservation
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';

interface LockMetadata {
  pid: number;
  time: number;
  host: string;
  exec: string;
}

/**
 * Checks if a lock file is stale and can be removed
 */
function isLockStale(lockPath: string, maxAgeMs: number = 10 * 60 * 1000): boolean {
  try {
    const stat = fs.statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    
    // If lock is older than max age, consider it stale
    if (ageMs > maxAgeMs) {
      return true;
    }
    
    // Try to read lock metadata
    try {
      const content = fs.readFileSync(lockPath, 'utf8');
      const metadata: LockMetadata = JSON.parse(content);
      
      // Check if process is still alive
      try {
        process.kill(metadata.pid, 0); // Signal 0 = check if process exists
        // Process exists, lock is not stale
        return false;
      } catch (e: any) {
        // ESRCH = no such process -> stale
        // EPERM = process exists but we don't have permission -> not stale
        if (e && e.code === 'ESRCH') {return true;}   // no such process -> stale
        if (e && e.code === 'EPERM') {return false;}  // alive but not ours -> not stale
        return false; // be conservative for unknown errors
      }
    } catch {
      // Can't read metadata, use age-based decision
      return ageMs > maxAgeMs;
    }
  } catch {
    // Can't stat lock file
    return false;
  }
}

/**
 * Attempts to acquire an exclusive lock with stale lock detection
 */
function acquireLock(lockPath: string): number | null {
  try {
    // Try to create lock exclusively
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    
    // Write lock metadata
    const metadata: LockMetadata = {
      pid: process.pid,
      time: Date.now(),
      host: os.hostname(),
      exec: process.execPath
    };
    
    fs.writeSync(fd, JSON.stringify(metadata, null, 2));
    fs.fsyncSync(fd); // Ensure metadata is written to disk
    
    return fd;
  } catch (err: any) {
    // Lock exists, check if it's stale
    if (err.code === 'EEXIST' && isLockStale(lockPath)) {
      try {
        // Remove stale lock and try once more
        fs.unlinkSync(lockPath);
        
        const fd = fs.openSync(lockPath, 'wx', 0o600);
        const metadata: LockMetadata = {
          pid: process.pid,
          time: Date.now(),
          host: os.hostname(),
          exec: process.execPath
        };
        fs.writeSync(fd, JSON.stringify(metadata, null, 2));
        fs.fsyncSync(fd);
        
        if (process.env.DEBUG?.includes('promptcode')) {
          console.error('[promptcode] Removed stale lock and acquired new lock');
        }
        
        return fd;
      } catch {
        // Still can't acquire, another process got it
        return null;
      }
    }
    
    return null;
  }
}

/**
 * Preflights a binary to ensure it can run
 */
function preflightBinary(binaryPath: string): boolean {
  try {
    const result = spawnSync(binaryPath, ['--version'], {
      timeout: 3000, // 3 second timeout
      encoding: 'utf8',
      stdio: 'pipe',
      // Isolate environment to prevent recursive finalization
      env: { 
        ...process.env, 
        PROMPTCODE_REEXEC_DEPTH: '0',
        PROMPTCODE_SKIP_FINALIZE: '1' 
      }
    });
    
    // Check if it executed successfully
    if (result.error || result.status !== 0) {
      if (process.env.DEBUG?.includes('promptcode')) {
        console.error(`[promptcode] Preflight failed for ${binaryPath}:`, result.error || `exit ${result.status}`);
      }
      return false;
    }
    
    return true;
  } catch (err) {
    if (process.env.DEBUG?.includes('promptcode')) {
      console.error(`[promptcode] Preflight exception for ${binaryPath}:`, err);
    }
    return false;
  }
}

/**
 * Cleans up old backup files
 */
function cleanupOldBackups(dir: string, baseName: string, currentBackup: string | null = null): void {
  try {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    if (process.env.DEBUG?.includes('promptcode')) {
      console.error(`[promptcode] Checking for old backups in ${dir}...`);
    }
    
    let cleanedCount = 0;
    let failedCount = 0;
    
    fs.readdirSync(dir).forEach(file => {
      if (file.startsWith(`${baseName}.bak.`) && (!currentBackup || file !== path.basename(currentBackup))) {
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs < oneDayAgo) {
            const ageInDays = Math.floor((Date.now() - stat.mtimeMs) / (24 * 60 * 60 * 1000));
            if (process.env.DEBUG?.includes('promptcode')) {
              console.error(`[promptcode] Deleting old backup: ${file} (${ageInDays} days old)`);
            }
            fs.unlinkSync(fullPath);
            cleanedCount++;
          }
        } catch (err: any) {
          // Tolerate ENOENT in case another process deleted it
          if (err.code !== 'ENOENT') {
            failedCount++;
            if (process.env.DEBUG?.includes('promptcode')) {
              console.error(`[promptcode] Failed to delete ${file}:`, err.message);
            }
          }
        }
      }
    });
    
    if (process.env.DEBUG?.includes('promptcode') && (cleanedCount > 0 || failedCount > 0)) {
      console.error(`[promptcode] Backup cleanup: ${cleanedCount} deleted, ${failedCount} failed`);
    }
  } catch (err) {
    if (process.env.DEBUG?.includes('promptcode')) {
      console.error('[promptcode] Backup cleanup error:', err);
    }
  }
}

/**
 * Finalizes a pending update by atomically swapping the staged binary
 * with the current one, then re-executing to ensure the new version
 * handles the current command.
 */
export function finalizeUpdateIfNeeded(): void {
  try {
    // Early exit if finalization is explicitly disabled or in test mode
    if (process.env.PROMPTCODE_SKIP_FINALIZE === '1' || process.env.PROMPTCODE_TEST === '1') {
      return;
    }

    // Skip on Windows - needs different approach
    if (process.platform === 'win32') {
      if (process.env.DEBUG?.includes('promptcode')) {
        console.error('[promptcode] Update finalization not supported on Windows yet');
      }
      return;
    }

    // Resolve the real target (handles symlinks)
    const realBin = fs.realpathSync(process.execPath);
    const staged = `${realBin}.new`;
    
    // Check if there's a pending update
    if (!fs.existsSync(staged)) {return;}

    // Skip if not actually our binary
    const baseName = path.basename(realBin);
    if (!/^promptcode([-.]|$)/.test(baseName)) {
      if (process.env.DEBUG?.includes('promptcode')) {
        console.error(`[promptcode] Skipping update for non-promptcode binary: ${baseName}`);
      }
      return;
    }
    
    // Check if this is a managed installation we shouldn't touch
    const managedPrefixes = [
      '/usr/local/Cellar',     // Homebrew macOS
      '/opt/homebrew/Cellar',  // Homebrew Apple Silicon
      '/home/linuxbrew',       // Homebrew Linux
      '/nix/store',            // Nix
      '/snap/',                // Snap packages
    ];
    
    if (managedPrefixes.some(prefix => realBin.startsWith(prefix))) {
      if (process.env.DEBUG?.includes('promptcode')) {
        console.error('[promptcode] Skipping update finalization for managed installation');
      }
      return;
    }

    // Get current binary stats early
    const curStat = fs.statSync(realBin);

    // NEVER update suid/sgid binaries
    if ((curStat.mode & 0o6000) !== 0) {
      if (process.env.DEBUG?.includes('promptcode')) {
        console.error('[promptcode] Refusing to update setuid/setgid binary');
      }
      return;
    }

    // Check directory safety
    const dir = path.dirname(realBin);
    const dirStat = fs.statSync(dir);
    if ((dirStat.mode & 0o022) !== 0) {
      if (process.env.DEBUG?.includes('promptcode')) {
        console.error('[promptcode] Refusing to update in group/world-writable directory');
      }
      return;
    }

    // Ensure staged is a regular file (not a symlink)
    const stagedStat = fs.lstatSync(staged);
    if (!stagedStat.isFile()) {
      console.error(chalk.red('[promptcode] Staged update is not a regular file, skipping'));
      return;
    }

    // Security: Ensure ownership matches
    if (stagedStat.uid !== curStat.uid || stagedStat.gid !== curStat.gid) {
      if (process.env.DEBUG?.includes('promptcode')) {
        console.error('[promptcode] Staged file ownership mismatch, skipping update');
      }
      return;
    }

    // Security: Ensure no hard links
    if (stagedStat.nlink > 1) {
      if (process.env.DEBUG?.includes('promptcode')) {
        console.error('[promptcode] Staged file has hard links, skipping update');
      }
      return;
    }

    // Single-writer lock to prevent concurrent swaps
    const lock = `${realBin}.update.lock`;
    let lockFd: number | null = null;
    
    // Try to acquire lock with stale detection
    lockFd = acquireLock(lock);
    if (lockFd === null) {
      // Another process is updating or lock is held
      return;
    }

    try {

      // Ensure staged binary has correct permissions and attributes BEFORE preflight
      try {
        const stagedFileStat = fs.statSync(staged);
        // Preserve all permission bits (including suid/sgid if present)
        const targetMode = curStat.mode & 0o7777;
        const stagedMode = stagedFileStat.mode & 0o7777;
        
        if (stagedMode !== targetMode) {
          fs.chmodSync(staged, targetMode);
        }
        
        // Best-effort: try to preserve ownership (may fail without privileges)
        try {
          if (stagedFileStat.uid !== curStat.uid || stagedFileStat.gid !== curStat.gid) {
            fs.chownSync(staged, curStat.uid, curStat.gid);
          }
        } catch {
          // Ignore ownership errors - common in non-privileged contexts
        }

        // On macOS, remove quarantine attribute if present
        if (process.platform === 'darwin') {
          try {
            spawnSync('xattr', ['-d', 'com.apple.quarantine', staged], { stdio: 'ignore' });
          } catch {
            // Ignore if xattr fails
          }
        }
      } catch (err) {
        console.error(chalk.red('[promptcode] Failed to prepare staged update:'), err);
        return;
      }

      // Preflight the staged binary AFTER preparation (permissions, quarantine removal)
      if (!preflightBinary(staged)) {
        console.error(chalk.red('[promptcode] Staged binary failed preflight check, aborting update'));
        return;
      }

      // Make an atomic backup via hard link (best), else copy
      const backup = `${realBin}.bak.${process.pid}`;
      try {
        fs.linkSync(realBin, backup); // atomic, same inode
      } catch (err: any) {
        // Hard link failed, try copy
        try {
          fs.copyFileSync(realBin, backup);
        } catch (copyErr: any) {
          // Check for specific errors
          if (copyErr.code === 'ENOSPC') {
            console.error(chalk.red('[promptcode] Insufficient disk space for backup, aborting update'));
          } else if (copyErr.code === 'EACCES' || copyErr.code === 'EPERM') {
            console.error(chalk.red('[promptcode] Permission denied creating backup, aborting update'));
          } else {
            console.error(chalk.red('[promptcode] Failed to create backup:'), copyErr.message);
          }
          return;
        }
      }

      // Atomic replace: .new -> current
      fs.renameSync(staged, realBin);

      // Extract version from the new binary for logging
      let newVersion = 'latest';
      try {
        const versionResult = spawnSync(realBin, ['--version'], {
          timeout: 5000,
          encoding: 'utf8',
          stdio: 'pipe'
        });
        if (versionResult.stdout) {
          const raw = versionResult.stdout.trim();
          // Add 'v' prefix only if not already present
          newVersion = /^v/i.test(raw) ? raw : `v${raw}`;
        }
      } catch {
        // Ignore version extraction errors
      }

      // CRITICAL: Release lock BEFORE spawning child
      if (lockFd !== null) {
        try { fs.closeSync(lockFd); } catch {}
        try { fs.unlinkSync(lock); } catch {}
        lockFd = null;
      }

      // Now clean up old backups WITHOUT holding the lock
      const dir = path.dirname(realBin);
      const baseName = path.basename(realBin);
      cleanupOldBackups(dir, baseName, backup);

      // Hand off to the new binary once (do not mutate process.env)
      if (process.env.PROMPTCODE_REEXEC_DEPTH !== '1') {
        const env = { ...process.env, PROMPTCODE_REEXEC_DEPTH: '1' };

        // Temporarily ignore signals during handoff to prevent double-handling
        const noop = () => {};
        const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP'];
        signals.forEach(sig => process.on(sig, noop));

        // Print update message before re-exec
        console.error(chalk.green(`[promptcode] Applied pending update to ${newVersion}; restarting...`));

        // Intelligently determine where user args start
        // Different runtimes have different argv shapes:
        // - Node script: [node, script, ...userArgs]
        // - Bun script: [bun, script, ...userArgs]
        // - Compiled binary: [binary, ...userArgs] or [binary, internalScript, ...userArgs]
        const argv = process.argv;
        const maybeScript = argv[1] || '';
        const looksLikePath = maybeScript === realBin
          || path.resolve(maybeScript) === realBin
          || maybeScript.includes('/')
          || /\.m?js$/.test(maybeScript)
          || path.basename(maybeScript).startsWith('promptcode');

        const userArgs = looksLikePath ? argv.slice(2) : argv.slice(1);

        const res = spawnSync(realBin, userArgs, {
          stdio: 'inherit',
          env,
        });

        // Restore signal handlers
        signals.forEach(sig => process.off(sig, noop));

        // If the child failed to spawn at all, roll back and continue
        if (res.error) {
          try {
            fs.renameSync(backup, realBin);
            console.error(chalk.yellow('[promptcode] Re-exec failed; rolled back to previous version.'));
          } catch {
            console.error(chalk.red('[promptcode] Update applied, but re-exec failed; continuing with running process.'));
            if (!process.env.DEBUG?.includes('promptcode')) {
              console.error(chalk.yellow('Rerun with DEBUG=promptcode for details.'));
            }
          }
          return;
        }

        // Child succeeded - delete current backup immediately
        try {
          fs.unlinkSync(backup);
          if (process.env.DEBUG?.includes('promptcode')) {
            console.error('[promptcode] Deleted current backup after successful update');
          }
        } catch {
          // Ignore if already deleted
        }

        // Child exited: propagate exact status/signal
        if (res.signal) {
          // Re-raise the same signal in the parent
          process.kill(process.pid, res.signal as NodeJS.Signals);
          // Fallback exit if kill doesn't terminate us
          process.exit(128);
        }
        
        if (typeof res.status === 'number') {
          process.exit(res.status);
        }

        // Fallback: exit non-zero if uncertain
        process.exit(1);
      }

      // If we're already in a re-exec (depth=1), do not re-exec again.
      // This path is effectively unreachable in normal operation
      console.error(chalk.green('[promptcode] Applied pending update successfully.'));
      
    } finally {
      // Always clean up the lock file if still held
      if (lockFd !== null) {
        try { fs.closeSync(lockFd); } catch {}
        try { fs.unlinkSync(lock); } catch {}
      }
    }
  } catch (err) {
    // Best-effort: never block startup on update issues
    // Only log in debug mode to avoid noise
    if (process.env.DEBUG?.includes('promptcode')) {
      console.error('[promptcode] Update finalization error:', err);
    }
  }
}