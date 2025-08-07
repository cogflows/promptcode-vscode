import { program } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getCacheDir, getConfigDir } from '../utils/paths';
import { removeFromClaudeMd, removeExpertCommand, findClaudeFolder } from '../utils/claude-integration';
import inquirer from 'inquirer';

async function removeDirectory(dir: string, description: string): Promise<boolean> {
  try {
    await fs.access(dir);
    await fs.rm(dir, { recursive: true, force: true });
    console.log(chalk.green(`✓ Removed ${description}: ${dir}`));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove Claude Code integration with user confirmation
 */
async function removeClaudeIntegration(projectPath: string, skipPrompts: boolean = false): Promise<boolean> {
  let removed = false;
  
  // Check if Claude integration exists
  const claudeDir = findClaudeFolder(projectPath);
  const claudeMdPath = claudeDir ? findClaudeMd(claudeDir) : path.join(projectPath, 'CLAUDE.md');
  const hasClaudeMdSection = fs.existsSync(claudeMdPath) && 
    fs.readFileSync(claudeMdPath, 'utf8').includes('<!-- PROMPTCODE-CLI-START -->');
  
  // If no integration found, return early
  if (!claudeDir && !hasClaudeMdSection) {
    return false;
  }
  
  console.log(chalk.bold('\nClaude Code Integration:'));
  
  // Remove CLAUDE.md section
  if (hasClaudeMdSection) {
    let shouldRemove = skipPrompts;
    if (!skipPrompts) {
      const { removeClaudeMdSection } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'removeClaudeMdSection',
          message: `Remove PromptCode section from ${path.basename(claudeMdPath)}?`,
          default: true
        }
      ]);
      shouldRemove = removeClaudeMdSection;
    }
    
    if (shouldRemove) {
      const result = await removeFromClaudeMd(projectPath);
      removed = removed || result;
    }
  }
  
  // Remove expert command and .claude folder contents
  if (claudeDir) {
    // Remove expert command
    const expertCommandPath = path.join(claudeDir, 'commands', 'expert-consultation.md');
    if (fs.existsSync(expertCommandPath)) {
      let shouldRemove = skipPrompts;
      if (!skipPrompts) {
        const { removeExpertCmd } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'removeExpertCmd',
            message: `Remove expert consultation command from .claude/commands/?`,
            default: true
          }
        ]);
        shouldRemove = removeExpertCmd;
      }
      
      if (shouldRemove) {
        const result = await removeExpertCommand(projectPath);
        if (result) {
          console.log(chalk.green(`✓ Removed expert consultation command`));
        }
        removed = removed || result;
      }
    }
    
    // Finally, ask about removing the entire .claude folder
    let shouldRemoveFolder = skipPrompts;
    if (!skipPrompts) {
      const { removeClaudeFolder } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'removeClaudeFolder',
          message: `Remove entire Claude Code folder at ${claudeDir}?`,
          default: false  // Default to false to be safe
        }
      ]);
      shouldRemoveFolder = removeClaudeFolder;
    }
    
    if (shouldRemoveFolder) {
      await removeDirectory(claudeDir, 'Claude Code folder');
      removed = true;
    }
  }
  
  return removed;
}

async function removeBinary(): Promise<void> {
  const binaryPath = process.execPath;
  
  // Check if we have write permissions
  try {
    await fs.access(binaryPath, fs.constants.W_OK);
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
    
    await fs.writeFile(batchFile, batchContent);
    console.log(chalk.yellow('✓ Created uninstall script'));
    console.log(chalk.yellow('  The binary will be removed after this process exits'));
    console.log(chalk.cyan(`  Run: ${batchFile}`));
  } else {
    // Unix-like systems: schedule deletion
    console.log(chalk.yellow('✓ The binary will be removed after this process exits'));
    console.log(chalk.yellow(`  Location: ${binaryPath}`));
    console.log(chalk.cyan(`  To remove manually: rm "${binaryPath}"`));
  }
}

export const uninstallCommand = program
  .command('uninstall')
  .description('Uninstall PromptCode CLI and optionally remove all data')
  .option('--yes', 'Skip confirmation prompts')
  .option('--keep-data', 'Keep configuration and cache files')
  .action(async (options) => {
    console.log(chalk.bold('\nPromptCode CLI Uninstaller\n'));
    
    // Confirm uninstall
    if (!options.yes) {
      const { confirmUninstall } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmUninstall',
          message: 'Are you sure you want to uninstall PromptCode CLI?',
          default: false
        }
      ]);
      
      if (!confirmUninstall) {
        console.log(chalk.yellow('Uninstall cancelled'));
        process.exit(0);
      }
    }
    
    let removedSomething = false;
    
    // Remove Claude Code integration (always ask, regardless of --keep-data)
    const ccRemoved = await removeClaudeIntegration(process.cwd(), options.yes);
    removedSomething = removedSomething || ccRemoved;
    
    // Remove data directories unless --keep-data is specified
    if (!options.keepData) {
      if (!options.yes) {
        const { removeData } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'removeData',
            message: 'Remove all configuration and cache files?',
            default: true
          }
        ]);
        
        if (removeData) {
          removedSomething = await removeDirectory(getCacheDir(), 'cache') || removedSomething;
          removedSomething = await removeDirectory(getConfigDir(), 'config') || removedSomething;
          
          // Also check for .promptcode directories in home and current directory
          const homePromptcode = path.join(require('os').homedir(), '.promptcode');
          removedSomething = await removeDirectory(homePromptcode, 'user data') || removedSomething;
          
          const currentPromptcode = path.join(process.cwd(), '.promptcode');
          if (await fs.access(currentPromptcode).then(() => true).catch(() => false)) {
            const { removeProject } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'removeProject',
                message: `Remove project PromptCode directory at ${currentPromptcode}?`,
                default: false
              }
            ]);
            
            if (removeProject) {
              removedSomething = await removeDirectory(currentPromptcode, 'project data') || removedSomething;
            }
          }
        }
      } else {
        // With --yes flag, remove all data without prompting
        removedSomething = await removeDirectory(getCacheDir(), 'cache') || removedSomething;
        removedSomething = await removeDirectory(getConfigDir(), 'config') || removedSomething;
        
        const homePromptcode = path.join(require('os').homedir(), '.promptcode');
        removedSomething = await removeDirectory(homePromptcode, 'user data') || removedSomething;
        
        // Also remove project directory if it exists (with --yes, remove everything)
        const currentPromptcode = path.join(process.cwd(), '.promptcode');
        if (await fs.access(currentPromptcode).then(() => true).catch(() => false)) {
          removedSomething = await removeDirectory(currentPromptcode, 'project data') || removedSomething;
        }
      }
    }
    
    // Remove the binary
    await removeBinary();
    
    console.log('');
    if (removedSomething) {
      console.log(chalk.green('✨ PromptCode CLI has been uninstalled'));
    }
    
    // PATH cleanup reminder
    console.log(chalk.yellow('\nRemember to remove PromptCode from your PATH if you added it:'));
    console.log(chalk.gray('  Check your shell configuration file (~/.bashrc, ~/.zshrc, etc.)'));
    console.log(chalk.gray('  Remove any lines that add promptcode to your PATH'));
    
    console.log('');
    console.log(chalk.gray('Thank you for using PromptCode! 👋'));
  });