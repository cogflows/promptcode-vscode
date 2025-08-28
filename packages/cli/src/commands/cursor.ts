import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import inquirer from 'inquirer';
import { getCursorTemplatesDir } from '../utils/paths';
import { spinner } from '../utils/spinner';
import { isInteractive } from '../utils/environment';
import { 
  findCursorFolder, 
  findCursorRulesFile,
  removeFromCursorRules, 
  removePromptCodeRules,
  removeFromMcpConfig,
  PROMPTCODE_CURSOR_RULES 
} from '../utils/cursor-integration';
import { findOrCreateIntegrationDir } from '../utils/integration-helper';
import { calculateChecksum, areContentsEquivalent } from '../utils/canonicalize';
import { isKnownTemplateVersion } from '../utils/template-checksums';

interface CursorOptions {
  path?: string;
  force?: boolean;
  yes?: boolean;
  uninstall?: boolean;
  skipModified?: boolean;
  all?: boolean;
}

/**
 * Create backup of a file if it exists
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
 * Update or create .cursorrules with PromptCode section (legacy support)
 */
async function updateCursorRulesLegacy(targetRulesFile: string): Promise<void> {
  const cursorRulesPath = targetRulesFile;
  
  // Read template
  const templatesDir = getCursorTemplatesDir();
  const templatePath = path.join(templatesDir, 'promptcode-usage.mdc');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`promptcode-usage.mdc not found at ${templatePath}`);
  }
  
  // Extract content without frontmatter (handle Windows CRLF)
  const fullContent = await fs.promises.readFile(templatePath, 'utf8');
  const templateContent = fullContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  
  // Wrap in markers
  const promptcodeSection = `<!-- PROMPTCODE-CURSOR-START -->
${templateContent}
<!-- PROMPTCODE-CURSOR-END -->`;
  
  // Check if .cursorrules exists
  if (fs.existsSync(cursorRulesPath)) {
    const existingContent = await fs.promises.readFile(cursorRulesPath, 'utf8');
    
    // Create backup before modifying
    const backupPath = createBackup(cursorRulesPath);
    
    // Check if PromptCode section already exists
    if (existingContent.includes('<!-- PROMPTCODE-CURSOR-START -->')) {
      // Replace existing section
      const updatedContent = existingContent.replace(
        /<!-- PROMPTCODE-CURSOR-START -->[\s\S]*?<!-- PROMPTCODE-CURSOR-END -->/,
        promptcodeSection
      );
      await fs.promises.writeFile(cursorRulesPath, updatedContent);
      console.log(chalk.green(`✓ Updated PromptCode section in ${path.basename(cursorRulesPath)}`));
    } else {
      // Append to existing file
      const updatedContent = existingContent.trimEnd() + '\n\n' + promptcodeSection;
      await fs.promises.writeFile(cursorRulesPath, updatedContent);
      console.log(chalk.green(`✓ Added PromptCode section to ${path.basename(cursorRulesPath)}`));
    }
    
    if (backupPath) {
      console.log(chalk.gray(`  Backup saved to: ${path.basename(backupPath)}`));
    }
  } else {
    // Create new .cursorrules
    await fs.promises.writeFile(cursorRulesPath, promptcodeSection);
    console.log(chalk.green(`✓ Created ${path.basename(cursorRulesPath)} with PromptCode instructions`));
  }
}

/**
 * Show preview of rules to be installed
 */
function showRulesPreview(cursorDir: string, rules: string[]): void {
  const rulesDir = path.join(cursorDir, 'rules');
  console.log(chalk.bold('\n📦 Rules to be installed:'));
  
  for (const rule of rules) {
    const rulePath = path.join(rulesDir, rule);
    const exists = fs.existsSync(rulePath);
    const ruleName = rule.replace('.mdc', '');
    
    if (exists) {
      console.log(chalk.gray(`  ✓ ${ruleName} (will update)`));
    } else {
      console.log(chalk.green(`  + ${ruleName} (new)`));
    }
  }
  console.log();
}

/**
 * Set up Cursor rules (.cursor/rules/*.mdc)
 */
async function setupCursorRules(projectPath: string, options?: CursorOptions & { skipPreview?: boolean }): Promise<{ cursorDir: string | null; isNew: boolean; stats: { created: number; updated: number; kept: number; unchanged: number } }> {
  // Find or create .cursor directory
  const { dir: cursorDir, isNew } = await findOrCreateIntegrationDir(
    projectPath,
    '.cursor',
    findCursorFolder
  );
  
  if (!cursorDir) {
    console.log(chalk.red('Cannot setup Cursor integration without .cursor directory'));
    return { cursorDir: null, isNew: false, stats: { created: 0, updated: 0, kept: 0, unchanged: 0 } };
  }
  
  // Show preview of what will be installed
  if (!options?.skipPreview) {
    showRulesPreview(cursorDir, PROMPTCODE_CURSOR_RULES);
  }
  
  const rulesDir = path.join(cursorDir, 'rules');
  
  // Create rules subdirectory (no approval needed since parent was approved)
  await fs.promises.mkdir(rulesDir, { recursive: true });
  
  // List of Cursor MDC files to install
  const rules = PROMPTCODE_CURSOR_RULES;
  
  const templatesDir = getCursorTemplatesDir();
  const stats = { created: 0, updated: 0, kept: 0, unchanged: 0 };
  
  for (const rule of rules) {
    const templatePath = path.join(templatesDir, rule);
    const rulePath = path.join(rulesDir, rule);
    
    if (!fs.existsSync(templatePath)) {
      console.warn(chalk.yellow(`⚠️  Template not found: ${rule}`));
      continue;
    }
    
    const result = await updateTemplateFile(
      templatePath,
      rulePath,
      rule,
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
  
  // Report what was done
  const actions = [];
  if (stats.created > 0) actions.push(`${stats.created} new`);
  if (stats.updated > 0) actions.push(`${stats.updated} updated`);
  if (stats.kept > 0) actions.push(`${stats.kept} kept`);
  if (stats.unchanged > 0) actions.push(`${stats.unchanged} unchanged`);
  
  if (actions.length > 0) {
    console.log(chalk.green(`✓ Cursor rules: ${actions.join(', ')}`));
  }
  
  // Add .gitignore if .cursor was newly created
  if (isNew) {
    const gitignoreContent = `.env
.env.*
!.env.example
*.log
tmp/
mcp.json
`;
    await fs.promises.writeFile(
      path.join(cursorDir, '.gitignore'),
      gitignoreContent
    );
  }
  
  return { cursorDir, isNew, stats };
}

// MCP configuration removed - will be added when MCP server is ready

/**
 * Cursor command - Set up or remove PromptCode Cursor integration
 */
export async function cursorCommand(options: CursorOptions & { detect?: boolean }): Promise<void> {
  // Special detection mode for installer
  if (options.detect) {
    const cursorDir = findCursorFolder(options.path || process.cwd());
    const cursorRulesFile = findCursorRulesFile(options.path || process.cwd());
    process.exit(cursorDir || cursorRulesFile ? 0 : 1);
  }
  
  const projectPath = path.resolve(options.path || process.cwd());
  
  // Handle uninstall
  if (options.uninstall) {
    console.log(chalk.bold('Removing PromptCode Cursor integration...'));
    
    let removed = false;
    
    // Always remove PromptCode rules from .cursor/rules/
    if (await removePromptCodeRules(projectPath)) {
      removed = true;
      console.log(chalk.green('✓ Removed Cursor rules'));
    }
    
    // Remove from .cursorrules (legacy) if --all flag is provided
    if (options.all) {
      if (await removeFromCursorRules(projectPath)) {
        removed = true;
        console.log(chalk.green('✓ Removed PromptCode section from .cursorrules'));
      }
    }
    
    // Remove from MCP config (future implementation)
    // if (await removeFromMcpConfig(projectPath)) {
    //   removed = true;
    // }
    
    if (!removed) {
      console.log(chalk.yellow('No PromptCode Cursor integration found'));
    } else {
      console.log(chalk.gray('\nTo reinstall, run: promptcode cursor'));
    }
    
    return;
  }
  
  // Handle setup
  
  // First show what will be installed BEFORE creating directories
  const cursorDirExists = fs.existsSync(path.join(projectPath, '.cursor'));
  
  console.log(chalk.bold('📦 Rules to be installed:'));
  for (const rule of PROMPTCODE_CURSOR_RULES) {
    const ruleName = rule.replace('.mdc', '');
    console.log(chalk.green(`  + ${ruleName}`));
  }
  
  if (!cursorDirExists) {
    console.log(chalk.bold('\n📁 Directory to be created:'));
    console.log(chalk.green('  + .cursor/'));
  }
  console.log();
  
  const spin = spinner();
  spin.start('Setting up PromptCode Cursor integration...');
  
  try {
    // Set up modern Cursor rules
    spin.text = 'Installing Cursor rules...';
    const { cursorDir, isNew, stats } = await setupCursorRules(projectPath, {
      ...options,
      skipPreview: true // Don't show preview again, we already did
    });
    
    if (!cursorDir) {
      // Fall back to legacy .cursorrules if user didn't approve new .cursor
      const existingCursorRulesFile = findCursorRulesFile(projectPath);
      if (existingCursorRulesFile) {
        spin.stop();
        
        // Ask about updating .cursorrules
        console.log(chalk.yellow('\n📝 .cursorrules exists (legacy mode)'));
        console.log(chalk.bold('\nWould you like to add PromptCode instructions to .cursorrules?'));
        console.log(chalk.gray('  • PromptCode CLI usage instructions'));
        console.log(chalk.gray('  • Command reference'));
        console.log(chalk.gray('  • Workflow examples'));
        
        let updateLegacy = false;
        if (!options.yes && !options.force && isInteractive()) {
          const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Update .cursorrules with PromptCode instructions?',
            default: false // Default to No like CC does
          }]);
          updateLegacy = proceed;
        } else if (options.yes || options.force) {
          updateLegacy = true;
        }
        
        if (updateLegacy) {
          spin.start('Updating .cursorrules...');
          await updateCursorRulesLegacy(existingCursorRulesFile);
          spin.succeed(chalk.green('PromptCode Cursor integration set up successfully!'));
          console.log(chalk.yellow('\n⚠️  Using legacy .cursorrules file. Consider migrating to .cursor/rules/'));
        } else {
          console.log(chalk.yellow('Setup cancelled - no changes made'));
          return;
        }
      } else {
        spin.fail(chalk.red('Setup cancelled'));
        return;
      }
    } else {
      spin.succeed(chalk.green('PromptCode Cursor integration set up successfully!'));
    }
    
    // Find where things were installed
    const cursorRulesFile = findCursorRulesFile(projectPath);
    
    console.log(chalk.bold('\n📝 Updated files:'));
    if (cursorDir) {
      const summary = [];
      if (stats.created > 0) summary.push(`${stats.created} new`);
      if (stats.updated > 0) summary.push(`${stats.updated} updated`);
      if (stats.kept > 0) summary.push(`${stats.kept} kept`);
      if (stats.unchanged > 0) summary.push(`${stats.unchanged} unchanged`);
      console.log(chalk.gray(`  ${path.relative(projectPath, path.join(cursorDir, 'rules/'))} - ${summary.length > 0 ? summary.join(', ') : `${PROMPTCODE_CURSOR_RULES.length} rules`}`));
    } else if (cursorRulesFile) {
      console.log(chalk.gray(`  ${path.relative(projectPath, cursorRulesFile)} - PromptCode usage instructions`));
    }
    
    console.log(chalk.bold('\n🚀 Next steps:'));
    console.log(chalk.gray('1. Open Cursor IDE in this project'));
    console.log(chalk.gray('2. The AI agent now understands PromptCode commands'));
    console.log(chalk.gray('3. Try: "List my PromptCode presets" or "/promptcode-preset-list"'));
    
    console.log(chalk.bold('\n💡 Quick commands in Cursor:'));
    console.log(chalk.cyan('  /promptcode-preset-list              # List presets'));
    console.log(chalk.cyan('  /promptcode-preset-info <preset>     # Show preset details'));
    console.log(chalk.cyan('  /promptcode-preset-create <name>     # Create new preset'));
    console.log(chalk.cyan('  /promptcode-ask-expert "question"    # Ask AI expert'));
    
    console.log(chalk.bold('\n🔑 API Keys:'));
    console.log(chalk.gray('For expert mode, set environment variables:'));
    console.log(chalk.gray('  export OPENAI_API_KEY=...   # For GPT-5/O3 models'));
    console.log(chalk.gray('  export ANTHROPIC_API_KEY=... # For Claude models'));
    
  } catch (error) {
    spin.fail(chalk.red(`Error: ${(error as Error).message}`))
    process.exit(1);
  }
}