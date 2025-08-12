import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { getClaudeTemplatesDir } from '../utils/paths';
import { spinner } from '../utils/spinner';
import { shouldSkipConfirmation } from '../utils/environment';
import { findClaudeFolder, findClaudeMd, removeFromClaudeMd, removePromptCodeCommands, PROMPTCODE_CLAUDE_COMMANDS, LEGACY_CLAUDE_COMMANDS } from '../utils/claude-integration';
import { findOrCreateIntegrationDir } from '../utils/integration-helper';

interface CcOptions {
  path?: string;
  force?: boolean;
  yes?: boolean;
  uninstall?: boolean;
}


/**
 * Add PromptCode section to CLAUDE.md or create it
 */
async function updateClaudeMd(claudeDir: string): Promise<void> {
  const claudeMdPath = findClaudeMd(claudeDir);
  
  // Read template
  const templatesDir = getClaudeTemplatesDir();
  const templatePath = path.join(templatesDir, 'CLAUDE.md.template');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`CLAUDE.md.template not found at ${templatePath}`);
  }
  
  const templateContent = await fs.promises.readFile(templatePath, 'utf8');
  
  // Check if CLAUDE.md exists
  if (fs.existsSync(claudeMdPath)) {
    const existingContent = await fs.promises.readFile(claudeMdPath, 'utf8');
    
    // Check if PromptCode section already exists
    if (existingContent.includes('<!-- PROMPTCODE-CLI-START -->')) {
      // Replace existing section (non-greedy to handle multiple sections)
      const updatedContent = existingContent.replace(
        /<!-- PROMPTCODE-CLI-START -->[\s\S]*?<!-- PROMPTCODE-CLI-END -->/,
        templateContent.trim()
      );
      await fs.promises.writeFile(claudeMdPath, updatedContent);
      console.log(chalk.green(`✓ Updated PromptCode section in ${claudeMdPath}`));
    } else {
      // Append to existing file
      const updatedContent = existingContent.trimEnd() + '\n\n' + templateContent;
      await fs.promises.writeFile(claudeMdPath, updatedContent);
      console.log(chalk.green(`✓ Added PromptCode section to ${claudeMdPath}`));
    }
  } else {
    // Create new CLAUDE.md
    await fs.promises.writeFile(claudeMdPath, templateContent);
    console.log(chalk.green(`✓ Created ${claudeMdPath} with PromptCode instructions`));
  }
}

/**
 * Set up Claude commands
 */
async function setupClaudeCommands(projectPath: string): Promise<{ claudeDir: string | null; isNew: boolean }> {
  // Find or create .claude directory
  const { dir: claudeDir, isNew } = await findOrCreateIntegrationDir(
    projectPath,
    '.claude',
    findClaudeFolder
  );
  
  if (!claudeDir) {
    console.log(chalk.red('Cannot setup Claude integration without .claude directory'));
    return { claudeDir: null, isNew: false };
  }
  
  const commandsDir = path.join(claudeDir, 'commands');
  
  // Create subdirectories (no approval needed since parent was approved)
  await fs.promises.mkdir(commandsDir, { recursive: true });
  
  // Clean up old/legacy command files before installing new ones
  for (const oldCmd of LEGACY_CLAUDE_COMMANDS) {
    const oldPath = path.join(commandsDir, oldCmd);
    if (fs.existsSync(oldPath)) {
      await fs.promises.unlink(oldPath);
      console.log(chalk.gray(`  Removed legacy command: ${oldCmd}`));
    }
  }
  
  // List of Claude commands to install
  const commands = PROMPTCODE_CLAUDE_COMMANDS;
  
  const templatesDir = getClaudeTemplatesDir();
  let installedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const command of commands) {
    const templatePath = path.join(templatesDir, command);
    const commandPath = path.join(commandsDir, command);
    
    if (fs.existsSync(templatePath)) {
      const newContent = await fs.promises.readFile(templatePath, 'utf8');
      
      // Check if file exists and has same content
      if (fs.existsSync(commandPath)) {
        const existingContent = await fs.promises.readFile(commandPath, 'utf8');
        if (existingContent === newContent) {
          skippedCount++;
          continue; // Skip if content is identical
        }
        updatedCount++;
      } else {
        installedCount++;
      }
      
      await fs.promises.writeFile(commandPath, newContent);
    }
  }
  
  // Report what was done
  const actions = [];
  if (installedCount > 0) actions.push(`${installedCount} new`);
  if (updatedCount > 0) actions.push(`${updatedCount} updated`);
  if (skippedCount > 0) actions.push(`${skippedCount} unchanged`);
  
  if (actions.length > 0) {
    console.log(chalk.green(`✓ Claude commands: ${actions.join(', ')}`));
  }
  
  // Clean up any legacy hooks from previous versions
  const hooksDir = path.join(claudeDir, 'hooks');
  const hookPath = path.join(hooksDir, 'promptcode-cost-approval.sh');
  if (fs.existsSync(hookPath)) {
    await fs.promises.unlink(hookPath);
    try {
      const files = await fs.promises.readdir(hooksDir);
      if (files.length === 0) {
        await fs.promises.rm(hooksDir, { recursive: false, force: true });
      }
    } catch (error) {
      // Directory might not exist
    }
  }
  
  // Clean up hook from settings.json if it exists
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const content = await fs.promises.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(content);
      
      if (settings.hooks?.PreToolUse) {
        // Remove our hook entry
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((hook: any) => 
          !(hook.matcher === 'Bash' && 
            hook.hooks?.some((h: any) => h.command?.includes('promptcode-cost-approval.sh')))
        );
        
        // Clean up empty structures
        if (settings.hooks.PreToolUse.length === 0) {
          delete settings.hooks.PreToolUse;
        }
        if (Object.keys(settings.hooks || {}).length === 0) {
          delete settings.hooks;
        }
        
        // Write back or remove settings file
        if (Object.keys(settings).length === 0) {
          await fs.promises.unlink(settingsPath);
        } else {
          await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2));
        }
      }
    } catch (error) {
      // Invalid JSON or other error, ignore
    }
  }
  
  // Add .gitignore if .claude was newly created
  if (isNew) {
    const gitignoreContent = `.env
.env.*
!.env.example
*.log
tmp/
`;
    await fs.promises.writeFile(
      path.join(claudeDir, '.gitignore'),
      gitignoreContent
    );
  }
  
  return { claudeDir, isNew };
}

/**
 * CC command - Set up or remove PromptCode CLI integration
 */
export async function ccCommand(options: CcOptions & { detect?: boolean }): Promise<void> {
  // Special detection mode for installer
  if (options.detect) {
    const claudeDir = findClaudeFolder(options.path || process.cwd());
    process.exit(claudeDir ? 0 : 1);
  }
  const projectPath = path.resolve(options.path || process.cwd());
  
  // Handle uninstall
  if (options.uninstall) {
    console.log(chalk.bold('Removing PromptCode CLI integration...'));
    
    let removed = false;
    
    // Remove from CLAUDE.md
    if (await removeFromClaudeMd(projectPath)) {
      removed = true;
    }
    
    // Remove PromptCode commands
    if (await removePromptCodeCommands(projectPath)) {
      removed = true;
    }
    
    if (!removed) {
      console.log(chalk.yellow('No PromptCode integration found'));
    } else {
      console.log(chalk.gray('\nTo reinstall, run: promptcode cc'));
    }
    
    return;
  }
  
  // Handle setup
  const spin = spinner();
  spin.start('Setting up PromptCode CLI integration...');
  
  try {
    // Set up Claude commands and get the directory
    spin.text = 'Setting up Claude integration...';
    const { claudeDir, isNew } = await setupClaudeCommands(projectPath);
    
    if (!claudeDir) {
      spin.fail(chalk.red('Setup cancelled'));
      return;
    }
    
    // Update or create CLAUDE.md
    spin.text = 'Updating project documentation...';
    await updateClaudeMd(claudeDir);
    
    spin.succeed(chalk.green('PromptCode CLI integration set up successfully!'));
    
    // Find where things were installed
    const claudeMdPath = findClaudeMd(claudeDir);
    
    console.log(chalk.bold('\n📝 Updated files:'));
    console.log(chalk.gray(`  ${path.relative(projectPath, claudeMdPath)} - PromptCode usage instructions`));
    if (claudeDir) {
      console.log(chalk.gray(`  ${path.relative(projectPath, path.join(claudeDir, 'commands/'))} - 5 Claude commands installed`));
    }
    
    console.log(chalk.bold('\n🚀 Next steps:'));
    console.log(chalk.gray('1. Review the PromptCode section in CLAUDE.md'));
    console.log(chalk.gray('2. Set up API keys via environment variables (e.g., export OPENAI_API_KEY=...)'));
    console.log(chalk.gray('3. Create presets with: promptcode preset create <name>'));
    
    console.log(chalk.bold('\n💡 Quick start:'));
    console.log(chalk.cyan('  promptcode preset list                    # See available presets'));
    console.log(chalk.cyan('  promptcode expert "Explain this code"     # Ask AI with context'));
    
  } catch (error) {
    spin.fail(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}