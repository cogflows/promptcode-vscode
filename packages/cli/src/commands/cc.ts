import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { ensureDirWithApproval, getClaudeTemplatesDir } from '../utils/paths';
import { spinner } from '../utils/spinner';
import { findClaudeFolder, findClaudeMd, removeFromClaudeMd, removeExpertCommand } from '../utils/claude-integration';

interface CcOptions {
  path?: string;
  force?: boolean;
  yes?: boolean;
  uninstall?: boolean;
}


/**
 * Add PromptCode section to CLAUDE.md or create it
 */
async function updateClaudeMd(projectPath: string): Promise<void> {
  // Find where .claude folder is (or would be)
  const existingClaudeDir = findClaudeFolder(projectPath);
  const claudeDir = existingClaudeDir || path.join(projectPath, '.claude');
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
      // Replace existing section
      const updatedContent = existingContent.replace(
        /<!-- PROMPTCODE-CLI-START -->[\s\S]*<!-- PROMPTCODE-CLI-END -->/,
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
 * Set up expert consultation command
 */
async function setupExpertCommand(projectPath: string): Promise<void> {
  // Find or create .claude folder
  const existingClaudeDir = findClaudeFolder(projectPath);
  const claudeDir = existingClaudeDir || path.join(projectPath, '.claude');
  const commandsDir = path.join(claudeDir, 'commands');
  
  // Create directories with approval
  if (!existingClaudeDir) {
    const claudeApproved = await ensureDirWithApproval(claudeDir, '.claude');
    if (!claudeApproved) {
      console.log(chalk.red('Cannot setup Claude integration without .claude directory'));
      return;
    }
  }
  
  // Create subdirectories (no approval needed since parent was approved)
  await fs.promises.mkdir(commandsDir, { recursive: true });
  
  // Copy expert consultation command
  const templatesDir = getClaudeTemplatesDir();
  const expertTemplatePath = path.join(templatesDir, 'expert-consultation.md');
  const expertCommandPath = path.join(commandsDir, 'expert-consultation.md');
  
  if (fs.existsSync(expertTemplatePath)) {
    const content = await fs.promises.readFile(expertTemplatePath, 'utf8');
    await fs.promises.writeFile(expertCommandPath, content);
    console.log(chalk.green(`✓ Added expert consultation command to ${commandsDir}`));
  }
  
  // Clean up any legacy hooks from previous versions
  const hooksDir = path.join(claudeDir, 'hooks');
  const hookPath = path.join(hooksDir, 'promptcode-cost-approval.sh');
  if (fs.existsSync(hookPath)) {
    await fs.promises.unlink(hookPath);
    try {
      const files = await fs.promises.readdir(hooksDir);
      if (files.length === 0) {
        await fs.promises.rmdir(hooksDir);
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
  
  // Add .gitignore if .claude didn't exist
  if (!existingClaudeDir) {
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
  
  // Handle --yes as alias for --force
  if (options.yes) {
    options.force = true;
  }
  
  // Handle uninstall
  if (options.uninstall) {
    console.log(chalk.bold('Removing PromptCode CLI integration...'));
    
    let removed = false;
    
    // Remove from CLAUDE.md
    if (await removeFromClaudeMd(projectPath)) {
      removed = true;
    }
    
    // Remove expert command
    if (await removeExpertCommand(projectPath)) {
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
    // Update or create CLAUDE.md
    spin.text = 'Updating project documentation...';
    await updateClaudeMd(projectPath);
    
    // Set up expert command
    spin.text = 'Setting up expert consultation command...';
    await setupExpertCommand(projectPath);
    
    spin.succeed(chalk.green('PromptCode CLI integration set up successfully!'));
    
    // Find where things were installed
    const claudeDir = findClaudeFolder(projectPath);
    const claudeMdPath = findClaudeMd(claudeDir || path.join(projectPath, '.claude'));
    
    console.log(chalk.bold('\n📝 Updated files:'));
    console.log(chalk.gray(`  ${path.relative(projectPath, claudeMdPath)} - PromptCode usage instructions`));
    if (claudeDir) {
      console.log(chalk.gray(`  ${path.relative(projectPath, path.join(claudeDir, 'commands/expert-consultation.md'))} - Expert consultation command`));
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
    spin.stop(); // Ensure cleanup
    process.exit(1);
  }
}