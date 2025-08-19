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
  } else {
    // Create new .cursorrules
    await fs.promises.writeFile(cursorRulesPath, promptcodeSection);
    console.log(chalk.green(`✓ Created ${path.basename(cursorRulesPath)} with PromptCode instructions`));
  }
}

/**
 * Set up Cursor rules (.cursor/rules/*.mdc)
 */
async function setupCursorRules(projectPath: string, options?: CursorOptions): Promise<{ cursorDir: string | null; isNew: boolean; stats: { created: number; updated: number; kept: number; unchanged: number } }> {
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
    
    // Remove from .cursorrules (legacy)
    if (await removeFromCursorRules(projectPath)) {
      removed = true;
    }
    
    // Remove PromptCode rules from .cursor/rules/
    if (await removePromptCodeRules(projectPath)) {
      removed = true;
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
  const spin = spinner();
  spin.start('Setting up PromptCode Cursor integration...');
  
  try {
    // Set up modern Cursor rules
    spin.text = 'Installing Cursor rules...';
    const { cursorDir, isNew, stats } = await setupCursorRules(projectPath, options);
    
    if (!cursorDir) {
      // Fall back to legacy .cursorrules if user didn't approve new .cursor
      const existingCursorRulesFile = findCursorRulesFile(projectPath);
      if (existingCursorRulesFile) {
        spin.text = 'Updating .cursorrules...';
        await updateCursorRulesLegacy(existingCursorRulesFile);
        console.log(chalk.yellow('\n⚠️  Using legacy .cursorrules file. Consider migrating to .cursor/rules/'));
        spin.succeed(chalk.green('PromptCode Cursor integration set up successfully!'));
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
    console.log(chalk.gray('  export OPENAI_API_KEY=...   # For O3/GPT models'));
    console.log(chalk.gray('  export ANTHROPIC_API_KEY=... # For Claude models'));
    
  } catch (error) {
    spin.fail(chalk.red(`Error: ${(error as Error).message}`))
    process.exit(1);
  }
}