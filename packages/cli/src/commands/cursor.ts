import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { getCursorTemplatesDir } from '../utils/paths';
import { spinner } from '../utils/spinner';
import { 
  findCursorFolder, 
  findCursorRulesFile,
  removeFromCursorRules, 
  removePromptCodeRules,
  removeFromMcpConfig,
  PROMPTCODE_CURSOR_RULES 
} from '../utils/cursor-integration';
import { findOrCreateIntegrationDir } from '../utils/integration-helper';

interface CursorOptions {
  path?: string;
  force?: boolean;
  yes?: boolean;
  uninstall?: boolean;
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
async function setupCursorRules(projectPath: string): Promise<{ cursorDir: string | null; isNew: boolean; installedCount?: number; updatedCount?: number; skippedCount?: number }> {
  // Find or create .cursor directory
  const { dir: cursorDir, isNew } = await findOrCreateIntegrationDir(
    projectPath,
    '.cursor',
    findCursorFolder
  );
  
  if (!cursorDir) {
    console.log(chalk.red('Cannot setup Cursor integration without .cursor directory'));
    return { cursorDir: null, isNew: false };
  }
  
  const rulesDir = path.join(cursorDir, 'rules');
  
  // Create rules subdirectory (no approval needed since parent was approved)
  await fs.promises.mkdir(rulesDir, { recursive: true });
  
  // List of Cursor MDC files to install
  const rules = PROMPTCODE_CURSOR_RULES;
  
  const templatesDir = getCursorTemplatesDir();
  let installedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const rule of rules) {
    const templatePath = path.join(templatesDir, rule);
    const rulePath = path.join(rulesDir, rule);
    
    if (!fs.existsSync(templatePath)) {
      console.warn(chalk.yellow(`⚠️  Template not found: ${rule}`));
      continue;
    }
    
    const newContent = await fs.promises.readFile(templatePath, 'utf8');
    
    // Check if file exists and has same content
    if (fs.existsSync(rulePath)) {
      const existingContent = await fs.promises.readFile(rulePath, 'utf8');
      if (existingContent === newContent) {
        skippedCount++;
        continue; // Skip if content is identical
      }
      updatedCount++;
    } else {
      installedCount++;
    }
    
    await fs.promises.writeFile(rulePath, newContent);
  }
  
  // Report what was done
  const actions = [];
  if (installedCount > 0) actions.push(`${installedCount} new`);
  if (updatedCount > 0) actions.push(`${updatedCount} updated`);
  if (skippedCount > 0) actions.push(`${skippedCount} unchanged`);
  
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
  
  return { cursorDir, isNew, installedCount, updatedCount, skippedCount };
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
    const { cursorDir, isNew, installedCount = 0, updatedCount = 0, skippedCount = 0 } = await setupCursorRules(projectPath);
    
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
      if (installedCount > 0) summary.push(`${installedCount} new`);
      if (updatedCount > 0) summary.push(`${updatedCount} updated`);
      if (skippedCount > 0) summary.push(`${skippedCount} unchanged`);
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