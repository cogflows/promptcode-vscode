import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { ensureDirWithApproval } from '../utils/paths';

interface CcOptions {
  path?: string;
  force?: boolean;
  yes?: boolean;
  uninstall?: boolean;
}

/**
 * Find .claude folder by searching up the directory tree
 */
function findClaudeFolder(startPath: string): string | null {
  let currentPath = path.resolve(startPath);
  const root = path.parse(currentPath).root;
  
  while (currentPath !== root) {
    const candidatePath = path.join(currentPath, '.claude');
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }
  
  const rootCandidate = path.join(root, '.claude');
  if (fs.existsSync(rootCandidate)) {
    return rootCandidate;
  }
  
  return null;
}

/**
 * Find CLAUDE.md file in the project root (where .claude folder is or should be)
 */
function findClaudeMd(claudeDir: string): string {
  // CLAUDE.md should be at the same level as .claude folder
  const projectRoot = path.dirname(claudeDir);
  return path.join(projectRoot, 'CLAUDE.md');
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
  const templatePath = path.join(__dirname, '..', 'claude-templates', 'CLAUDE.md.template');
  if (!fs.existsSync(templatePath)) {
    throw new Error('CLAUDE.md.template not found');
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
 * Remove PromptCode section from CLAUDE.md
 */
async function removeFromClaudeMd(projectPath: string): Promise<boolean> {
  const existingClaudeDir = findClaudeFolder(projectPath);
  if (!existingClaudeDir) {
    return false;
  }
  
  const claudeMdPath = findClaudeMd(existingClaudeDir);
  if (!fs.existsSync(claudeMdPath)) {
    return false;
  }
  
  const content = await fs.promises.readFile(claudeMdPath, 'utf8');
  
  // Check if PromptCode section exists
  if (!content.includes('<!-- PROMPTCODE-CLI-START -->')) {
    return false;
  }
  
  // Remove PromptCode section
  const updatedContent = content.replace(
    /\n*<!-- PROMPTCODE-CLI-START -->[\s\S]*<!-- PROMPTCODE-CLI-END -->\n*/,
    '\n'
  );
  
  // If file would be empty or just whitespace, delete it
  if (!updatedContent.trim()) {
    await fs.promises.unlink(claudeMdPath);
    console.log(chalk.green(`✓ Removed empty ${claudeMdPath}`));
  } else {
    await fs.promises.writeFile(claudeMdPath, updatedContent.trimEnd() + '\n');
    console.log(chalk.green(`✓ Removed PromptCode section from ${claudeMdPath}`));
  }
  
  return true;
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
  const expertTemplatePath = path.join(__dirname, '..', 'claude-templates', 'expert-consultation.md');
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
 * Remove expert consultation command
 */
async function removeExpertCommand(projectPath: string): Promise<boolean> {
  const claudeDir = findClaudeFolder(projectPath);
  if (!claudeDir) {
    return false;
  }
  
  let removed = false;
  
  // Remove expert command
  const expertCommandPath = path.join(claudeDir, 'commands', 'expert-consultation.md');
  if (fs.existsSync(expertCommandPath)) {
    await fs.promises.unlink(expertCommandPath);
    removed = true;
    
    // Remove commands directory if empty
    const commandsDir = path.join(claudeDir, 'commands');
    try {
      const files = await fs.promises.readdir(commandsDir);
      if (files.length === 0) {
        await fs.promises.rmdir(commandsDir);
      }
    } catch (error) {
      // Directory might not exist
    }
  }
  
  // Remove hook
  const hookPath = path.join(claudeDir, 'hooks', 'promptcode-cost-approval.sh');
  if (fs.existsSync(hookPath)) {
    await fs.promises.unlink(hookPath);
    removed = true;
    
    // Remove hooks directory if empty
    const hooksDir = path.join(claudeDir, 'hooks');
    try {
      const files = await fs.promises.readdir(hooksDir);
      if (files.length === 0) {
        await fs.promises.rmdir(hooksDir);
      }
    } catch (error) {
      // Directory might not exist
    }
  }
  
  // Remove hook from settings.json
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
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
        
        // Write back or remove settings file
        if (Object.keys(settings).length === 0) {
          await fs.promises.unlink(settingsPath);
        } else {
          await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2));
        }
        
        removed = true;
      }
    } catch (error) {
      // Invalid JSON or other error, ignore
    }
  }
  
  return removed;
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
  const spinner = ora('Setting up PromptCode CLI integration...').start();
  
  try {
    // Update or create CLAUDE.md
    spinner.text = 'Updating project documentation...';
    await updateClaudeMd(projectPath);
    
    // Set up expert command
    spinner.text = 'Setting up expert consultation command...';
    await setupExpertCommand(projectPath);
    
    spinner.succeed(chalk.green('PromptCode CLI integration set up successfully!'));
    
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
    console.log(chalk.gray('2. Set up API keys with: promptcode config --set-<provider>-key'));
    console.log(chalk.gray('3. Create presets with: promptcode preset create <name>'));
    
    console.log(chalk.bold('\n💡 Quick start:'));
    console.log(chalk.cyan('  promptcode preset list                    # See available presets'));
    console.log(chalk.cyan('  promptcode expert "Explain this code"     # Ask AI with context'));
    
  } catch (error) {
    spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}