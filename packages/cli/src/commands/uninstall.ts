import { program } from 'commander';
import chalk from 'chalk';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { getCacheDir, getConfigDir, isSafeToRemove } from '../utils/paths';
import { removeFromClaudeMd, removePromptCodeCommands, findClaudeFolder, findClaudeMd, hasPromptCodeSection, PROMPTCODE_CLAUDE_COMMANDS, LEGACY_CLAUDE_COMMANDS } from '../utils/claude-integration';
import { safeConfirm } from '../utils/safe-prompts';

async function removeDirectory(dir: string, description: string, dryRun: boolean = false): Promise<boolean> {
  try {
    await fsp.access(dir);
    
    // Check if path is safe to delete (not a symlink, within expected locations)
    const stats = await fsp.lstat(dir);
    if (stats.isSymbolicLink()) {
      console.log(chalk.red(`✗ Refusing to delete symlink: ${dir}`));
      return false;
    }
    
    // Safety check to prevent accidental deletion of critical directories
    if (!isSafeToRemove(dir)) {
      console.log(chalk.red(`✗ Safety check failed: refusing to delete ${dir}`));
      console.log(chalk.yellow('  This directory appears to be a critical system directory or does not contain "promptcode"'));
      return false;
    }
    
    if (dryRun) {
      console.log(chalk.yellow(`[DRY-RUN] Would remove ${description}: ${dir}`));
    } else {
      await fsp.rm(dir, { recursive: true, force: true });
      console.log(chalk.green(`✓ Removed ${description}: ${dir}`));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove Claude Code integration with user confirmation
 */
async function removeClaudeIntegration(projectPath: string, skipPrompts: boolean = false, dryRun: boolean = false): Promise<boolean> {
  let removed = false;
  
  // Check if Claude integration exists
  const claudeDir = findClaudeFolder(projectPath);
  const claudeMdPath = findClaudeMd(claudeDir || projectPath);
  const hasClaudeMdSection = fs.existsSync(claudeMdPath) && 
    hasPromptCodeSection(fs.readFileSync(claudeMdPath, 'utf8'));
  
  // If no integration found, return early
  if (!claudeDir && !hasClaudeMdSection) {
    return false;
  }
  
  console.log(chalk.bold('\nClaude Code Integration:'));
  
  // Remove CLAUDE.md section
  if (hasClaudeMdSection) {
    let shouldRemove = skipPrompts;
    if (!skipPrompts && !dryRun) {
      shouldRemove = await safeConfirm(
        `Remove PromptCode section from ${path.basename(claudeMdPath)}?`,
        false  // Safe default
      );
    }
    
    if (shouldRemove) {
      if (dryRun) {
        console.log(chalk.yellow(`[DRY-RUN] Would remove PromptCode section from ${claudeMdPath}`));
        removed = true;
      } else {
        const result = await removeFromClaudeMd(projectPath);
        removed = removed || result;
      }
    }
  }
  
  // Remove PromptCode commands from .claude folder
  if (claudeDir) {
    // Check if any PromptCode commands exist
    const commandsDir = path.join(claudeDir, 'commands');
    const allCommands = [...PROMPTCODE_CLAUDE_COMMANDS, ...LEGACY_CLAUDE_COMMANDS];
    
    const existingCommands = allCommands.filter(cmd => 
      fs.existsSync(path.join(commandsDir, cmd))
    );
    
    if (existingCommands.length > 0) {
      // Show what commands would be removed
      console.log(chalk.gray(`  Found ${existingCommands.length} PromptCode command(s):`));
      existingCommands.forEach(cmd => {
        console.log(chalk.gray(`    - ${cmd}`));
      });
      
      let shouldRemove = skipPrompts;
      if (!skipPrompts && !dryRun) {
        shouldRemove = await safeConfirm(
          `Remove these ${existingCommands.length} PromptCode command(s)?`,
          false  // Safe default
        );
      }
      
      if (shouldRemove) {
        if (dryRun) {
          console.log(chalk.yellow(`[DRY-RUN] Would remove ${existingCommands.length} PromptCode commands`));
          removed = true;
        } else {
          const result = await removePromptCodeCommands(projectPath);
          if (result) {
            console.log(chalk.green(`✓ Removed PromptCode commands`));
          }
          removed = removed || result;
        }
      }
    }
    
    // NEVER delete the entire .claude folder - it contains user's Claude Code settings
    // Only PromptCode-specific files were removed above
  }
  
  return removed;
}

async function removeBinary(): Promise<void> {
  const binaryPath = process.execPath;
  
  // Check if we have write permissions
  try {
    await fsp.access(binaryPath, fsp.constants.W_OK);
  } catch {
    console.log(chalk.red(`✗ Cannot remove binary at ${binaryPath}`));
    console.log(chalk.yellow('  You may need to run with sudo or remove it manually'));
    
    // Check if installed via package manager
    if (binaryPath.includes('/usr/') || binaryPath.includes('brew')) {
      console.log(chalk.yellow('\n  If installed via package manager, use:'));
      console.log(chalk.cyan('    brew uninstall promptcode  # Homebrew'));
      console.log(chalk.cyan('    apt remove promptcode      # APT'));
      console.log(chalk.cyan('    npm uninstall -g @promptcode/cli  # npm'));
    }
    return;
  }
  
  // On Windows, we can't delete the running executable
  if (process.platform === 'win32') {
    const batchFile = path.join(path.dirname(binaryPath), 'uninstall.bat');
    const batchContent = `
@echo off
echo Waiting for PromptCode to close...
timeout /t 2 /nobreak > nul
del "${binaryPath}"
if exist "${binaryPath}" (
  echo Failed to remove PromptCode. Please delete manually: ${binaryPath}
) else (
  echo PromptCode has been uninstalled successfully.
)
del "%~f0"
`;
    
    await fsp.writeFile(batchFile, batchContent);
    console.log(chalk.yellow('✓ Created uninstall script'));
    console.log(chalk.yellow('  The binary will be removed after this process exits'));
    console.log(chalk.cyan(`  Run: ${batchFile}`));
  } else {
    // Unix-like systems: try to rename first, then schedule deletion
    const backupPath = `${binaryPath}.old`;
    try {
      // Try to rename the binary (this usually works even for running executables)
      await fsp.rename(binaryPath, backupPath);
      console.log(chalk.yellow('✓ Binary moved to backup location'));
      
      // Schedule deletion of backup on exit
      process.on('exit', () => {
        try {
          fs.unlinkSync(backupPath);
        } catch {
          // Ignore errors - user can manually delete
        }
      });
    } catch {
      // If rename fails, just inform the user
      console.log(chalk.yellow('✓ The binary needs to be removed manually'));
      console.log(chalk.yellow(`  Location: ${binaryPath}`));
      console.log(chalk.cyan(`  To remove: rm "${binaryPath}"`));
    }
  }
}

export const uninstallCommand = program
  .command('uninstall')
  .description('Uninstall PromptCode CLI and optionally remove all data')
  .option('--yes', 'Skip confirmation prompts')
  .option('--keep-data', 'Keep configuration and cache files')
  .option('--dry-run', 'Show what would be removed without removing')
  .option('--apply', 'Actually perform the uninstall (required without --yes)')
  .action(async (options) => {
    console.log(chalk.bold('\nPromptCode CLI Uninstaller\n'));
    
    // In dry-run mode, show what would be done
    if (options.dryRun) {
      console.log(chalk.yellow('🔍 DRY-RUN MODE - No changes will be made\n'));
    }
    
    // Require --apply or --yes to actually perform uninstall
    if (!options.dryRun && !options.apply && !options.yes) {
      console.log(chalk.yellow('⚠️  Safety mode: This is a preview of what will be removed.'));
      console.log(chalk.yellow('   To actually uninstall, use --apply or --yes flag.\n'));
      options.dryRun = true; // Force dry-run mode for safety
    }
    
    // Confirm uninstall
    if (!options.yes && !options.dryRun) {
      const confirmUninstall = await safeConfirm(
        'Are you sure you want to uninstall PromptCode CLI?',
        false
      );

      if (!confirmUninstall) {
        console.log(chalk.yellow('Uninstall cancelled'));
        process.exit(0);
      }
    }
    
    let removedSomething = false;
    
    // Remove Claude Code integration (always ask, regardless of --keep-data)
    const ccRemoved = await removeClaudeIntegration(process.cwd(), options.yes, options.dryRun);
    removedSomething = removedSomething || ccRemoved;
    
    // Remove data directories unless --keep-data is specified
    if (!options.keepData) {
      if (!options.yes && !options.dryRun) {
        const removeData = await safeConfirm(
          'Remove all configuration and cache files?',
          false  // Safe default
        );

        if (removeData) {
          removedSomething = await removeDirectory(getCacheDir(), 'cache', options.dryRun) || removedSomething;
          removedSomething = await removeDirectory(getConfigDir(), 'config', options.dryRun) || removedSomething;
          
          // Also check for .promptcode directories in home and current directory
          const homePromptcode = path.join(require('os').homedir(), '.promptcode');
          removedSomething = await removeDirectory(homePromptcode, 'user data', options.dryRun) || removedSomething;
          
          const currentPromptcode = path.join(process.cwd(), '.promptcode');
          if (await fsp.access(currentPromptcode).then(() => true).catch(() => false)) {
            const removeProject = await safeConfirm(
              `Remove project PromptCode directory at ${currentPromptcode}?`,
              false
            );

            if (removeProject) {
              removedSomething = await removeDirectory(currentPromptcode, 'project data', options.dryRun) || removedSomething;
            }
          }
        }
      } else if (options.yes && !options.dryRun) {
        // With --yes flag, remove all data without prompting (but respect dry-run)
        removedSomething = await removeDirectory(getCacheDir(), 'cache', options.dryRun) || removedSomething;
        removedSomething = await removeDirectory(getConfigDir(), 'config', options.dryRun) || removedSomething;
        
        const homePromptcode = path.join(require('os').homedir(), '.promptcode');
        removedSomething = await removeDirectory(homePromptcode, 'user data', options.dryRun) || removedSomething;
        
        // Also remove project directory if it exists (with --yes, remove everything)
        const currentPromptcode = path.join(process.cwd(), '.promptcode');
        if (await fsp.access(currentPromptcode).then(() => true).catch(() => false)) {
          removedSomething = await removeDirectory(currentPromptcode, 'project data', options.dryRun) || removedSomething;
        }
      }
    }
    
    // Remove the binary (skip in dry-run mode)
    if (!options.dryRun) {
      await removeBinary();
    } else {
      console.log(chalk.yellow(`[DRY-RUN] Would remove binary at ${process.execPath}`));
    }
    
    console.log('');
    if (options.dryRun) {
      console.log(chalk.yellow('🔍 DRY-RUN COMPLETE - No changes were made'));
      console.log(chalk.yellow('\nTo actually perform the uninstall, run:'));
      console.log(chalk.cyan('  promptcode uninstall --apply'));
      console.log(chalk.gray('  or'));
      console.log(chalk.cyan('  promptcode uninstall --yes'));
    } else if (removedSomething) {
      console.log(chalk.green('✨ PromptCode CLI has been uninstalled'));
      
      // PATH cleanup reminder
      console.log(chalk.yellow('\nRemember to remove PromptCode from your PATH if you added it:'));
      console.log(chalk.gray('  Check your shell configuration file (~/.bashrc, ~/.zshrc, etc.)'));
      console.log(chalk.gray('  Remove any lines that add promptcode to your PATH'));
      
      console.log('');
      console.log(chalk.gray('Thank you for using PromptCode! 👋'));
    } else {
      console.log(chalk.yellow('No changes were made'));
    }
  });