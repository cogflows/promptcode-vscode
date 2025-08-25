import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import inquirer from 'inquirer';
import { getClaudeTemplatesDir } from '../utils/paths';
import { spinner } from '../utils/spinner';
import { shouldSkipConfirmation, isInteractive } from '../utils/environment';
import { findClaudeFolder, findClaudeMd, removeFromClaudeMd, removePromptCodeCommands, PROMPTCODE_CLAUDE_COMMANDS, LEGACY_CLAUDE_COMMANDS } from '../utils/claude-integration';
import { findOrCreateIntegrationDir } from '../utils/integration-helper';
import { calculateChecksum, areContentsEquivalent } from '../utils/canonicalize';
import { isKnownTemplateVersion } from '../utils/template-checksums';

interface CcOptions {
  path?: string;
  force?: boolean;
  yes?: boolean;
  uninstall?: boolean;
  skipModified?: boolean;
  withDocs?: boolean;
  dryRun?: boolean;
  all?: boolean;
  docsOnly?: boolean;
  diff?: boolean;
  check?: boolean;
}

/**
 * Update a single template file with smart conflict detection
 */
async function updateTemplateFile(
  templatePath: string,
  targetPath: string,
  fileName: string,
  options?: { skipModified?: boolean }
): Promise<'created' | 'updated' | 'unchanged' | 'kept' | 'replaced'> {
  const newContent = await fs.promises.readFile(templatePath, 'utf8');
  
  if (!fs.existsSync(targetPath)) {
    await fs.promises.writeFile(targetPath, newContent);
    return 'created';
  }
  
  const existingContent = await fs.promises.readFile(targetPath, 'utf8');
  
  // Check if identical
  if (existingContent === newContent) {
    return 'unchanged';
  }
  
  // Check if only formatting differs
  const fileExt = path.extname(fileName).toLowerCase();
  if (areContentsEquivalent(existingContent, newContent, fileExt)) {
    await fs.promises.writeFile(targetPath, newContent);
    return 'updated';
  }
  
  // Calculate checksum to see if it's a known version
  const existingChecksum = calculateChecksum(existingContent, fileExt);
  
  if (isKnownTemplateVersion(fileName, existingChecksum)) {
    // File matches a known version - safe to auto-update
    await fs.promises.writeFile(targetPath, newContent);
    return 'updated';
  }
  
  // File has user modifications
  if (options?.skipModified) {
    console.log(chalk.yellow(`  ⚠️  Skipping ${fileName} (contains local changes)`));
    return 'kept';
  }
  
  if (!isInteractive()) {
    console.log(chalk.yellow(`  ⚠️  Skipping ${fileName} (contains local changes, non-interactive)`));
    return 'kept';
  }
  
  // Show diff
  const patch = createTwoFilesPatch(
    fileName, fileName,
    existingContent, newContent,
    'Current', 'New'
  );
  
  console.log(chalk.yellow(`\n📝 File has local changes: ${fileName}`));
  console.log(patch);
  
  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'What would you like to do?',
    choices: [
      { name: 'Keep my version', value: 'keep' },
      { name: 'Use new version (discard my changes)', value: 'replace' },
      { name: 'Skip for now', value: 'skip' }
    ],
    default: 'keep'
  }]);
  
  if (action === 'replace') {
    await fs.promises.writeFile(targetPath, newContent);
    return 'replaced';
  }
  
  return 'kept';
}

/**
 * Create backup of CLAUDE.md if it exists
 */
function createBackup(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupPath = `${filePath}.bak-${timestamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Add PromptCode section to CLAUDE.md or create it
 */
async function updateClaudeMd(claudeDir: string, options?: { dryRun?: boolean; diff?: boolean }): Promise<{ updated: boolean; diff?: string; backupPath?: string }> {
  const claudeMdPath = findClaudeMd(claudeDir);
  
  // Read template
  const templatesDir = getClaudeTemplatesDir();
  const templatePath = path.join(templatesDir, 'CLAUDE.md.template');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`CLAUDE.md.template not found at ${templatePath}`);
  }
  
  const templateContent = await fs.promises.readFile(templatePath, 'utf8');
  let diff: string | undefined;
  let backupPath: string | undefined;
  
  // Check if CLAUDE.md exists
  if (fs.existsSync(claudeMdPath)) {
    const existingContent = await fs.promises.readFile(claudeMdPath, 'utf8');
    let updatedContent: string;
    
    // Check if PromptCode section already exists
    if (existingContent.includes('<!-- PROMPTCODE-CLI-START -->')) {
      // Replace ALL existing sections (global match to handle multiple occurrences)
      updatedContent = existingContent.replace(
        /<!-- PROMPTCODE-CLI-START -->[\s\S]*?<!-- PROMPTCODE-CLI-END -->/g,
        templateContent.trim()
      );
    } else {
      // Append to existing file
      updatedContent = existingContent.trimEnd() + '\n\n' + templateContent;
    }
    
    if (updatedContent !== existingContent) {
      diff = createTwoFilesPatch(
        'CLAUDE.md', 'CLAUDE.md',
        existingContent, updatedContent,
        'Current', 'New'
      );
      
      if (options?.diff) {
        // Just show diff and return
        console.log(diff);
        return { updated: false, diff };
      }
      
      if (!options?.dryRun) {
        // Create backup before modifying
        const backup = createBackup(claudeMdPath);
        if (backup) {
          backupPath = backup;
        }
        
        await fs.promises.writeFile(claudeMdPath, updatedContent);
        console.log(chalk.green(`✓ Updated PromptCode section in ${claudeMdPath}`));
        if (backupPath) {
          console.log(chalk.gray(`  Backup saved to: ${path.basename(backupPath)}`));
        }
      } else {
        console.log(chalk.yellow('\nChanges to be made (dry-run):'));
        console.log(diff);
      }
      return { updated: true, diff, backupPath };
    } else {
      if (!options?.dryRun) {
        console.log(chalk.gray(`✓ ${claudeMdPath} is already up to date`));
      }
      return { updated: false };
    }
  } else {
    // Create new CLAUDE.md
    diff = createTwoFilesPatch(
      'CLAUDE.md', 'CLAUDE.md',
      '', templateContent,
      'Current', 'New'
    );
    
    if (options?.diff) {
      console.log(diff);
      return { updated: false, diff };
    }
    
    if (!options?.dryRun) {
      await fs.promises.writeFile(claudeMdPath, templateContent);
      console.log(chalk.green(`✓ Created ${claudeMdPath} with PromptCode instructions`));
    } else {
      console.log(chalk.yellow('\nFile to be created (dry-run):'));
      console.log(chalk.gray(claudeMdPath));
      console.log(diff);
    }
    return { updated: true, diff };
  }
}


/**
 * Set up Claude commands
 */
async function setupClaudeCommands(projectPath: string, options?: CcOptions): Promise<{ claudeDir: string | null; isNew: boolean; stats: { created: number; updated: number; kept: number; unchanged: number } }> {
  // Find or create .claude directory
  const { dir: claudeDir, isNew } = await findOrCreateIntegrationDir(
    projectPath,
    '.claude',
    findClaudeFolder
  );
  
  if (!claudeDir) {
    console.log(chalk.red('Cannot setup Claude integration without .claude directory'));
    return { claudeDir: null, isNew: false, stats: { created: 0, updated: 0, kept: 0, unchanged: 0 } };
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
  const stats = { created: 0, updated: 0, kept: 0, unchanged: 0 };
  
  for (const command of commands) {
    const templatePath = path.join(templatesDir, command);
    const commandPath = path.join(commandsDir, command);
    
    if (fs.existsSync(templatePath)) {
      const result = await updateTemplateFile(
        templatePath,
        commandPath,
        command,
        { skipModified: options?.skipModified }
      );
      
      switch (result) {
        case 'created': stats.created++; break;
        case 'updated': stats.updated++; break;
        case 'kept': stats.kept++; break;
        case 'replaced': stats.updated++; break;
        case 'unchanged': stats.unchanged++; break;
      }
    }
  }
  
  // Report what was done
  const actions = [];
  if (stats.created > 0) { actions.push(`${stats.created} new`); }
  if (stats.updated > 0) { actions.push(`${stats.updated} updated`); }
  if (stats.kept > 0) { actions.push(`${stats.kept} kept`); }
  if (stats.unchanged > 0) { actions.push(`${stats.unchanged} unchanged`); }
  
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
  
  return { claudeDir, isNew, stats };
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
  
  // Handle docs-only operations
  if (options.docsOnly) {
    const claudeDir = findClaudeFolder(projectPath);
    
    if (!claudeDir) {
      console.log(chalk.red('No .claude directory found. Run "promptcode cc" to set up Claude integration first.'));
      process.exit(1);
    }
    
    if (options.check) {
      // Check if CLAUDE.md needs updating (for CI)
      const result = await updateClaudeMd(claudeDir, { dryRun: true });
      if (result.updated) {
        console.log(chalk.yellow('CLAUDE.md needs updating'));
        process.exit(1);
      } else {
        console.log(chalk.green('CLAUDE.md is up to date'));
        process.exit(0);
      }
    } else if (options.diff) {
      // Show diff without writing
      await updateClaudeMd(claudeDir, { diff: true });
      return;
    } else {
      // Update CLAUDE.md
      const spin = spinner();
      spin.start('Updating CLAUDE.md...');
      
      try {
        const result = await updateClaudeMd(claudeDir, { dryRun: options.dryRun });
        
        if (result.updated) {
          if (!options.dryRun) {
            spin.succeed(chalk.green('CLAUDE.md updated successfully'));
          } else {
            spin.succeed(chalk.yellow('Dry-run complete (no changes made)'));
          }
        } else {
          spin.succeed(chalk.gray('CLAUDE.md is already up to date'));
        }
      } catch (error) {
        spin.fail(chalk.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    }
    return;
  }
  
  // Handle uninstall
  if (options.uninstall) {
    console.log(chalk.bold('Removing PromptCode CLI integration...'));
    
    let removed = false;
    
    // Remove commands (always)
    if (await removePromptCodeCommands(projectPath)) {
      removed = true;
      console.log(chalk.green('✓ Removed Claude commands'));
    }
    
    // Remove from CLAUDE.md if --all flag is provided
    if (options.all) {
      if (await removeFromClaudeMd(projectPath)) {
        removed = true;
        console.log(chalk.green('✓ Removed PromptCode section from CLAUDE.md'));
      }
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
    const { claudeDir, isNew, stats } = await setupClaudeCommands(projectPath, {
      ...options,
      skipModified: options.yes || options.force || !isInteractive()
    });
    
    if (!claudeDir) {
      spin.fail(chalk.red('Setup cancelled'));
      return;
    }
    
    // Update CLAUDE.md only if --with-docs flag is provided
    if (options.withDocs) {
      spin.text = 'Updating project documentation...';
      await updateClaudeMd(claudeDir);
    }
    
    spin.succeed(chalk.green('PromptCode CLI integration set up successfully!'));
    
    // Show what was installed
    console.log(chalk.bold('\n📝 Installed:'));
    if (claudeDir) {
      console.log(chalk.gray(`  ${path.relative(projectPath, path.join(claudeDir, 'commands/'))} - ${PROMPTCODE_CLAUDE_COMMANDS.length} Claude commands`));
    }
    if (options.withDocs) {
      const claudeMdPath = findClaudeMd(claudeDir);
      console.log(chalk.gray(`  ${path.relative(projectPath, claudeMdPath)} - PromptCode usage instructions`));
    }
    
    console.log(chalk.bold('\n🚀 Next steps:'));
    if (!options.withDocs) {
      console.log(chalk.gray('1. (Optional) Add docs: promptcode cc docs update'));
      console.log(chalk.gray('2. Set up API keys via environment variables'));
    } else {
      console.log(chalk.gray('1. Review the PromptCode section in CLAUDE.md'));
      console.log(chalk.gray('2. Set up API keys via environment variables'));
    }
    console.log(chalk.gray('3. Use the /promptcode-* commands in Claude Code'));
    
    console.log(chalk.bold('\n💡 Quick start:'));
    console.log(chalk.cyan('  Open Claude Code and type /promptcode-preset-list'));
    
  } catch (error) {
    spin.fail(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}