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
import chalk from 'chalk';

/**
 * Finalizes a pending update by atomically swapping the staged binary
 * with the current one, then re-executing to ensure the new version
 * handles the current command.
 */
export function finalizeUpdateIfNeeded(): void {
  try {
    // Resolve the real target (handles symlinks)
    const realBin = fs.realpathSync(process.execPath);
    const staged = `${realBin}.new`;
    
    // Check if there's a pending update
    if (!fs.existsSync(staged)) return;

    // Single-writer lock to prevent concurrent swaps
    const lock = `${realBin}.update.lock`;
    let lockFd: number | undefined;
    
    try {
      // Try to acquire exclusive lock (fails if another process is updating)
      lockFd = fs.openSync(lock, 'wx', 0o600);
    } catch {
      // Someone else is finalizing; let them finish
      return;
    }

    try {
      const curStat = fs.statSync(realBin);

      // Ensure staged binary is executable and matches old mode
      try {
        const stagedStat = fs.statSync(staged);
        const targetMode = curStat.mode & 0o777;
        
        // Preserve executable bits and other permissions
        if ((stagedStat.mode & 0o111) === 0 || stagedStat.mode !== targetMode) {
          fs.chmodSync(staged, targetMode);
        }
        
        // Best-effort: try to preserve ownership (may fail without privileges)
        try {
          if (stagedStat.uid !== curStat.uid || stagedStat.gid !== curStat.gid) {
            fs.chownSync(staged, curStat.uid, curStat.gid);
          }
        } catch {
          // Ignore ownership errors - common in non-privileged contexts
        }
      } catch (err) {
        // If we can't stat or chmod the staged file, abort
        console.error(chalk.red('[promptcode] Failed to prepare staged update:'), err);
        return;
      }

      // Make an atomic backup via hard link (best), else copy
      const backup = `${realBin}.bak.${process.pid}`;
      try {
        fs.linkSync(realBin, backup); // atomic, same inode
      } catch {
        // Hard link failed (different filesystem or permission issue)
        fs.copyFileSync(realBin, backup); // slower, but works across filesystems
      }

      // Atomic replace: .new -> current
      fs.renameSync(staged, realBin);

      // Extract version from the new binary for logging
      let newVersion = 'latest';
      try {
        const versionResult = spawnSync(realBin, ['--version'], {
          timeout: 5000,
          encoding: 'utf8'
        });
        if (versionResult.stdout) {
          newVersion = versionResult.stdout.trim();
        }
      } catch {
        // Ignore version extraction errors
      }

      // Hand off to the new binary once (do not mutate process.env)
      if (process.env.PROMPTCODE_REEXEC_DEPTH !== '1') {
        const env = { ...process.env, PROMPTCODE_REEXEC_DEPTH: '1' };

        // Temporarily ignore signals during handoff to prevent double-handling
        const noop = () => {};
        process.on('SIGINT', noop);
        process.on('SIGTERM', noop);

        // Print update message before re-exec
        console.error(chalk.green(`[promptcode] Applied pending update to v${newVersion}; restarting...`));

        const res = spawnSync(realBin, process.argv.slice(2), {
          stdio: 'inherit',
          env,
        });

        // Restore signal handlers
        process.off('SIGINT', noop);
        process.off('SIGTERM', noop);

        // If the child failed to spawn at all, roll back and continue
        if (res.error) {
          try {
            fs.renameSync(backup, realBin);
            console.error(chalk.yellow('[promptcode] Re-exec failed; rolled back to previous version.'));
          } catch {
            console.error(chalk.red('[promptcode] Update applied, but re-exec failed; continuing with running process.'));
          }
          return;
        }

        // Clean up old backups (older than 1 day)
        try {
          const dir = path.dirname(realBin);
          const baseName = path.basename(realBin);
          const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
          
          if (process.env.DEBUG?.includes('promptcode')) {
            console.error(`[promptcode] Checking for old backups in ${dir}...`);
          }
          
          let cleanedCount = 0;
          let failedCount = 0;
          
          fs.readdirSync(dir).forEach(file => {
            if (file.startsWith(`${baseName}.bak.`) && file !== path.basename(backup)) {
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
              } catch (err) {
                failedCount++;
                if (process.env.DEBUG?.includes('promptcode')) {
                  console.error(`[promptcode] Failed to delete ${file}:`, err);
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

        // Child exited: propagate exact status/signal
        if (typeof res.status === 'number') {
          process.exit(res.status);
        }
        
        if (res.signal) {
          // Normalize typical signals to their standard exit codes
          const sigNum: Record<string, number> = { 
            SIGINT: 2,    // Ctrl+C -> exit 130 (128 + 2)
            SIGTERM: 15,  // Termination -> exit 143 (128 + 15)
            SIGKILL: 9,   // Kill -> exit 137 (128 + 9)
            SIGHUP: 1,    // Hangup -> exit 129 (128 + 1)
          };
          const code = 128 + (sigNum[res.signal] ?? 0);
          process.exit(code);
        }

        // Fallback: exit non-zero if uncertain
        process.exit(1);
      }

      // If we're already in a re-exec (depth=1), do not re-exec again.
      // Just print a simple message and continue with normal execution
      console.error(chalk.green('[promptcode] Applied pending update successfully.'));
      
      // Clean up the current backup since we're running successfully
      try {
        const backup = `${realBin}.bak.${process.pid}`;
        if (fs.existsSync(backup)) {
          fs.unlinkSync(backup);
        }
      } catch {
        // Ignore cleanup errors
      }
      
    } finally {
      // Always clean up the lock file
      if (lockFd !== undefined) {
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