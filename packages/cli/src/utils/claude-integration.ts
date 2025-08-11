import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';

/**
 * PromptCode command files for Claude
 */
export const PROMPTCODE_CLAUDE_COMMANDS = [
  'promptcode-ask-expert.md',
  'promptcode-preset-list.md',
  'promptcode-preset-info.md',
  'promptcode-preset-create.md',
  'promptcode-preset-to-prompt.md'
];

/**
 * Legacy command files to clean up
 */
export const LEGACY_CLAUDE_COMMANDS = [
  'expert-consultation.md'
];

/**
 * Find .claude folder by searching up the directory tree
 */
export function findClaudeFolder(startPath: string): string | null {
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
export function findClaudeMd(claudeDirOrProjectPath: string): string {
  // If it's a .claude directory, go up one level
  if (path.basename(claudeDirOrProjectPath) === '.claude') {
    return path.join(path.dirname(claudeDirOrProjectPath), 'CLAUDE.md');
  }
  // Otherwise assume it's the project path
  return path.join(claudeDirOrProjectPath, 'CLAUDE.md');
}

/**
 * Check if a markdown string has PromptCode section
 */
export function hasPromptCodeSection(content: string): boolean {
  return content.includes('<!-- PROMPTCODE-CLI-START -->');
}

/**
 * Remove PromptCode section from CLAUDE.md
 */
export async function removeFromClaudeMd(projectPath: string): Promise<boolean> {
  // Try to find existing .claude folder, but don't require it
  const existingClaudeDir = findClaudeFolder(projectPath);
  const claudeMdPath = findClaudeMd(existingClaudeDir || projectPath);
  
  if (!fs.existsSync(claudeMdPath)) {
    return false;
  }
  
  const content = await fs.promises.readFile(claudeMdPath, 'utf8');
  
  // Check if PromptCode section exists
  if (!content.includes('<!-- PROMPTCODE-CLI-START -->')) {
    return false;
  }
  
  // Remove PromptCode section (handle both Unix and Windows line endings)
  const updatedContent = content.replace(
    /\r?\n*<!-- PROMPTCODE-CLI-START -->[\s\S]*?<!-- PROMPTCODE-CLI-END -->\r?\n*/,
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
 * Remove all PromptCode commands from .claude/commands/
 */
export async function removePromptCodeCommands(projectPath: string): Promise<boolean> {
  const claudeDir = findClaudeFolder(projectPath);
  if (!claudeDir) {
    return false;
  }
  
  let removed = false;
  
  // All PromptCode command files (old and new)
  const allCommands = [...PROMPTCODE_CLAUDE_COMMANDS, ...LEGACY_CLAUDE_COMMANDS];
  
  for (const commandFile of allCommands) {
    const commandPath = path.join(claudeDir, 'commands', commandFile);
    if (fs.existsSync(commandPath)) {
      await fs.promises.unlink(commandPath);
      removed = true;
    }
  }
  
  if (removed) {
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
  
  // Remove hook (legacy cleanup)
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