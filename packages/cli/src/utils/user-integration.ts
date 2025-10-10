import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import chalk from 'chalk';
import { calculateChecksum, areContentsEquivalent } from './canonicalize';
import { isKnownTemplateVersion } from './template-checksums';
import { isInteractive } from './environment';
import { safePrompt } from './safe-prompts';
import { getUserClaudeCommandsDir, getUserCursorRulesDir } from './paths';
import { createTwoFilesPatch } from 'diff';

export interface UserIntegrationOptions {
  integrationType: 'claude' | 'cursor';
  files: string[];
  templatesDir: string;
  skipModified?: boolean;
  force?: boolean;
}

export interface InstallStats {
  installed: number;
  updated: number;
  skipped: number;
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
  const newContent = await fs.readFile(templatePath, 'utf8');

  if (!fsSync.existsSync(targetPath)) {
    await fs.writeFile(targetPath, newContent);
    return 'created';
  }

  const existingContent = await fs.readFile(targetPath, 'utf8');

  // Check if identical
  if (existingContent === newContent) {
    return 'unchanged';
  }

  // Check if only formatting differs
  const fileExt = path.extname(fileName).toLowerCase();
  if (areContentsEquivalent(existingContent, newContent, fileExt)) {
    await fs.writeFile(targetPath, newContent);
    return 'updated';
  }

  // Calculate checksum to see if it's a known version
  const existingChecksum = calculateChecksum(existingContent, fileExt);

  if (isKnownTemplateVersion(fileName, existingChecksum)) {
    // File matches a known version - safe to auto-update
    await fs.writeFile(targetPath, newContent);
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

  const { action } = await safePrompt(
    [{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Keep my version', value: 'keep' },
        { name: 'Use new version (discard my changes)', value: 'replace' },
        { name: 'Skip for now', value: 'skip' }
      ],
      default: 'keep'
    }],
    { action: 'keep' } // Default to keep if prompts fail
  );

  if (action === 'replace') {
    await fs.writeFile(targetPath, newContent);
    return 'replaced';
  }

  return 'kept';
}

/**
 * Get the user integration directory for the specified type
 */
export function getUserIntegrationDir(integrationType: 'claude' | 'cursor'): string {
  return integrationType === 'claude' ? getUserClaudeCommandsDir() : getUserCursorRulesDir();
}

/**
 * Set up user-wide integration (Claude commands or Cursor rules)
 */
export async function setupUserIntegration(options: UserIntegrationOptions): Promise<InstallStats> {
  const { integrationType, files, templatesDir, skipModified } = options;
  const targetDir = getUserIntegrationDir(integrationType);

  // Create user integration directory (no approval needed for user config dir)
  await fs.mkdir(targetDir, { recursive: true });

  const stats = { installed: 0, updated: 0, skipped: 0 };

  for (const fileName of files) {
    const templatePath = path.join(templatesDir, fileName);
    const targetPath = path.join(targetDir, fileName);

    if (!fsSync.existsSync(templatePath)) {
      console.warn(chalk.yellow(`⚠️  Template not found: ${fileName}`));
      continue;
    }

    const result = await updateTemplateFile(
      templatePath,
      targetPath,
      fileName,
      { skipModified }
    );

    switch (result) {
      case 'created':
        stats.installed++;
        break;
      case 'updated':
      case 'replaced':
        stats.updated++;
        break;
      case 'kept':
      case 'unchanged':
        stats.skipped++;
        break;
    }
  }

  return stats;
}

/**
 * Remove user-wide integration
 */
export async function removeUserIntegration(integrationType: 'claude' | 'cursor'): Promise<boolean> {
  const targetDir = getUserIntegrationDir(integrationType);

  if (!fsSync.existsSync(targetDir)) {
    return false;
  }

  try {
    // Read all files in the directory
    const files = await fs.readdir(targetDir);

    if (files.length === 0) {
      // Empty directory, just remove it
      await fs.rmdir(targetDir);
      return true;
    }

    // Remove all files
    for (const file of files) {
      await fs.unlink(path.join(targetDir, file));
    }

    // Remove the directory
    await fs.rmdir(targetDir);

    return true;
  } catch (error) {
    console.error(chalk.red(`Failed to remove user integration: ${(error as Error).message}`));
    return false;
  }
}
