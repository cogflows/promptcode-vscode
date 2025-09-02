import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { detectIntegrations, hasAnyIntegration } from '../utils/integration-detector';
import { isInteractive } from '../utils/environment';
import { ccCommand } from './cc';
import { cursorCommand } from './cursor';
import { ensurePromptcodeScaffold } from '../utils/paths';
import { findClaudeFolder } from '../utils/claude-integration';
import { findCursorFolder, findCursorRulesFile } from '../utils/cursor-integration';

interface IntegrateOptions {
  path?: string;
  autoDetect?: boolean;
  yes?: boolean;
  force?: boolean;
  skipModified?: boolean;
}

/**
 * Unified command to set up or update AI environment integrations
 */
export async function integrateCommand(options: IntegrateOptions): Promise<void> {
  const projectPath = options.path || process.cwd();
  
  // Detect available integrations
  const integrations = await detectIntegrations(projectPath);
  
  if (!hasAnyIntegration(integrations)) {
    if (!options.autoDetect) {
      console.log(chalk.yellow('No AI environment integrations detected.'));
      console.log(chalk.gray('\nSupported environments:'));
      console.log(chalk.gray('  • Claude Code (.claude directory)'));
      console.log(chalk.gray('  • Cursor IDE (.cursor directory or .cursorrules file)'));
    }
    // Silent exit in auto-detect mode
    return;
  }
  
  let setupCount = 0;
  
  // Offer Claude Code integration
  if (integrations.claude.detected) {
    let shouldSetup = !options.autoDetect;
    
    if (options.autoDetect && isInteractive()) {
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: 'Claude Code detected. Set up integration?',
        default: true
      }]);
      shouldSetup = proceed;
    }
    
    if (shouldSetup) {
      console.log(chalk.bold('\n🤖 Setting up Claude Code integration...'));
      await ccCommand({ 
        path: projectPath, 
        yes: true,
        skipModified: options.skipModified,
        force: options.force
      });
      
      // Create .promptcode next to .claude
      const claudeDir = findClaudeFolder(projectPath);
      if (claudeDir) {
        const claudeRoot = path.dirname(claudeDir);
        await ensurePromptcodeScaffold(claudeRoot, true);
      }
      
      setupCount++;
    }
  }
  
  // Offer Cursor integration
  if (integrations.cursor.detected) {
    let shouldSetup = !options.autoDetect;
    
    if (options.autoDetect && isInteractive()) {
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: `Cursor ${integrations.cursor.hasLegacyRules ? '(.cursorrules)' : ''} detected. Set up integration?`,
        default: true
      }]);
      shouldSetup = proceed;
    }
    
    if (shouldSetup) {
      console.log(chalk.bold('\n🎯 Setting up Cursor integration...'));
      await cursorCommand({ 
        path: projectPath, 
        yes: true,
        skipModified: options.skipModified,
        force: options.force
      });
      
      // Create .promptcode next to .cursor or .cursorrules
      const cursorDir = findCursorFolder(projectPath);
      const cursorRules = findCursorRulesFile(projectPath);
      const cursorRoot = cursorDir 
        ? path.dirname(cursorDir) 
        : (cursorRules ? path.dirname(cursorRules) : projectPath);
      await ensurePromptcodeScaffold(cursorRoot, true);
      
      setupCount++;
    }
  }
  
  // Summary
  if (setupCount > 0 && options.autoDetect) {
    console.log(chalk.green(`\n✨ Integration setup complete!`));
    console.log(chalk.gray('Your AI environments are now configured with PromptCode.'));
  }
}