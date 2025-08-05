import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { scanFiles, initializeTokenCounter } from '@promptcode/core';

interface PresetOptions {
  path?: string;
  list?: boolean;
  create?: string;
  info?: string;
  delete?: string;
  edit?: string;
  search?: string;
}

/**
 * Get the presets directory path
 */
function getPresetsDir(projectPath: string): string {
  return path.join(projectPath, '.promptcode', 'presets');
}

/**
 * Ensure presets directory exists
 */
async function ensurePresetsDir(presetsDir: string): Promise<void> {
  await fs.promises.mkdir(presetsDir, { recursive: true });
}

/**
 * List all presets
 */
async function listPresets(presetsDir: string): Promise<void> {
  try {
    const files = await fs.promises.readdir(presetsDir);
    const presets = files.filter(f => f.endsWith('.patterns'));
    
    if (presets.length === 0) {
      console.log(chalk.yellow('No presets found. Create one with: promptcode preset --create <name>'));
      return;
    }
    
    console.log(chalk.bold('Available presets:'));
    console.log(chalk.gray('─'.repeat(50)));
    
    for (const preset of presets) {
      const presetName = preset.replace('.patterns', '');
      const presetPath = path.join(presetsDir, preset);
      const content = await fs.promises.readFile(presetPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      
      console.log(`  ${chalk.cyan(presetName.padEnd(20))} ${chalk.gray(`${lines.length} patterns`)}`);
    }
    
    console.log(chalk.gray('\nUse: promptcode generate -l <preset-name>'));
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      console.log(chalk.yellow('No presets directory found. Create one with: promptcode preset --create <name>'));
    } else {
      throw error;
    }
  }
}

/**
 * Show preset info with token count
 */
async function showPresetInfo(presetName: string, projectPath: string): Promise<void> {
  const spinner = ora('Analyzing preset...').start();
  
  try {
    // Initialize token counter
    const cacheDir = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '', '.cache', 'promptcode');
    initializeTokenCounter(cacheDir, '0.1.0');
    
    const presetsDir = getPresetsDir(projectPath);
    const presetPath = path.join(presetsDir, `${presetName}.patterns`);
    
    if (!fs.existsSync(presetPath)) {
      spinner.fail(`Preset not found: ${presetName}`);
      return;
    }
    
    const content = await fs.promises.readFile(presetPath, 'utf8');
    const patterns = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    
    // Scan files using patterns
    const files = await scanFiles({
      cwd: projectPath,
      patterns,
      respectGitignore: true,
      workspaceName: path.basename(projectPath)
    });
    
    spinner.stop();
    
    const totalTokens = files.reduce((sum, f) => sum + f.tokenCount, 0);
    
    console.log(chalk.bold(`Preset: ${chalk.cyan(presetName)}`));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Path: ${presetPath}`);
    console.log(`Patterns: ${patterns.length}`);
    console.log(`Files matched: ${chalk.cyan(files.length)}`);
    console.log(`Total tokens: ${chalk.cyan(totalTokens.toLocaleString())}`);
    
    if (files.length > 0) {
      console.log(chalk.bold('\nTop files by tokens:'));
      const topFiles = files
        .sort((a, b) => b.tokenCount - a.tokenCount)
        .slice(0, 10);
      
      for (const file of topFiles) {
        const relativePath = path.relative(projectPath, file.path);
        console.log(`  ${relativePath.padEnd(50)} ${chalk.gray(file.tokenCount.toLocaleString() + ' tokens')}`);
      }
    }
    
    console.log(chalk.bold('\nPatterns:'));
    patterns.forEach(p => console.log(`  ${p}`));
    
    console.log(chalk.bold('\nUsage Examples:'));
    console.log(chalk.gray('  # Generate prompt with this preset:'));
    console.log(`  ${chalk.cyan(`promptcode generate --preset ${presetName}`)}`);
    console.log(`  ${chalk.cyan(`promptcode generate -p ${presetName} -o output.md`)}`);
    
    console.log(chalk.gray('\n  # Ask AI expert with this preset:'));
    console.log(`  ${chalk.cyan(`promptcode expert "Explain the architecture" --preset ${presetName}`)}`);
    console.log(`  ${chalk.cyan(`promptcode "What are the security risks?" --preset ${presetName}`)}`);
    
    console.log(chalk.gray('\n  # Save output to file:'));
    console.log(`  ${chalk.cyan(`promptcode generate --preset ${presetName} --output /tmp/${presetName}-${new Date().toISOString().split('T')[0]}.txt`)}`);
    
  } catch (error) {
    spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
  }
}

/**
 * Create a new preset interactively
 */
async function createPreset(presetName: string, projectPath: string): Promise<void> {
  const presetsDir = getPresetsDir(projectPath);
  await ensurePresetsDir(presetsDir);
  
  const presetPath = path.join(presetsDir, `${presetName}.patterns`);
  
  if (fs.existsSync(presetPath)) {
    console.log(chalk.red(`Preset already exists: ${presetName}`));
    console.log(chalk.gray('Use --edit to modify it'));
    return;
  }
  
  // Create default content
  const defaultContent = `# ${presetName} preset
# Use gitignore syntax for patterns
# Include patterns:
**/*.ts
**/*.tsx
**/*.js
**/*.jsx

# Exclude patterns (use ! prefix):
!**/node_modules/**
!**/*.test.*
!**/*.spec.*
!**/dist/**
!**/build/**
`;
  
  await fs.promises.writeFile(presetPath, defaultContent);
  console.log(chalk.green(`✓ Created preset: ${presetName}`));
  console.log(chalk.gray(`  Path: ${presetPath}`));
  console.log(chalk.gray(`  Edit the file to customize patterns`));
  console.log(chalk.gray(`  Use: promptcode generate -l ${presetName}`));
}

/**
 * Delete a preset
 */
async function deletePreset(presetName: string, projectPath: string): Promise<void> {
  const presetsDir = getPresetsDir(projectPath);
  const presetPath = path.join(presetsDir, `${presetName}.patterns`);
  
  if (!fs.existsSync(presetPath)) {
    console.log(chalk.red(`Preset not found: ${presetName}`));
    return;
  }
  
  await fs.promises.unlink(presetPath);
  console.log(chalk.green(`✓ Deleted preset: ${presetName}`));
}

/**
 * Search presets by query string
 */
async function searchPresets(query: string, projectPath: string): Promise<void> {
  const presetsDir = getPresetsDir(projectPath);
  
  try {
    const files = await fs.promises.readdir(presetsDir);
    const presets = files.filter(f => f.endsWith('.patterns'));
    
    if (presets.length === 0) {
      console.log(chalk.yellow('No presets found to search'));
      return;
    }
    
    const queryLower = query.toLowerCase();
    const results: Array<{ name: string; score: number; matches: string[] }> = [];
    
    for (const preset of presets) {
      const presetName = preset.replace('.patterns', '');
      const presetPath = path.join(presetsDir, preset);
      const content = await fs.promises.readFile(presetPath, 'utf8');
      const lines = content.split('\n');
      
      let score = 0;
      const matches: string[] = [];
      
      // Check preset name
      if (presetName.toLowerCase().includes(queryLower)) {
        score += 10;
        matches.push(`Name: ${presetName}`);
      }
      
      // Check content lines
      lines.forEach((line, index) => {
        const lineLower = line.toLowerCase();
        if (lineLower.includes(queryLower)) {
          if (line.startsWith('#')) {
            // Comments are more valuable
            score += 3;
            matches.push(`Comment (line ${index + 1}): ${line.trim()}`);
          } else if (line.trim()) {
            score += 1;
            matches.push(`Pattern (line ${index + 1}): ${line.trim()}`);
          }
        }
      });
      
      if (score > 0) {
        results.push({ name: presetName, score, matches });
      }
    }
    
    if (results.length === 0) {
      console.log(chalk.yellow(`No presets found matching: "${query}"`));
      return;
    }
    
    // Sort by score
    results.sort((a, b) => b.score - a.score);
    
    console.log(chalk.bold(`Search results for: "${query}"`));
    console.log(chalk.gray('─'.repeat(50)));
    
    for (const result of results) {
      console.log(`\n${chalk.cyan(result.name)} ${chalk.gray(`(score: ${result.score})`)}`);
      // Show first 3 matches
      result.matches.slice(0, 3).forEach(match => {
        console.log(chalk.gray(`  ${match}`));
      });
      if (result.matches.length > 3) {
        console.log(chalk.gray(`  ... and ${result.matches.length - 3} more matches`));
      }
    }
    
    console.log(chalk.gray('\nUse: promptcode preset info <name> to see full details'));
    
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      console.log(chalk.yellow('No presets directory found'));
    } else {
      throw error;
    }
  }
}

/**
 * Edit a preset (open in editor)
 */
async function editPreset(presetName: string, projectPath: string): Promise<void> {
  const presetsDir = getPresetsDir(projectPath);
  const presetPath = path.join(presetsDir, `${presetName}.patterns`);
  
  if (!fs.existsSync(presetPath)) {
    console.log(chalk.red(`Preset not found: ${presetName}`));
    console.log(chalk.gray('Use --create to create it'));
    return;
  }
  
  // Check if we're in an interactive terminal
  const isInteractive = process.stdout.isTTY && process.stdin.isTTY;
  
  if (!isInteractive) {
    console.log(chalk.yellow('Non-interactive environment detected.'));
    console.log(chalk.bold(`\nPreset location:`));
    console.log(chalk.cyan(presetPath));
    console.log(chalk.gray('\nEdit this file manually to update patterns.'));
    
    // Show current content
    console.log(chalk.bold('\nCurrent patterns:'));
    const content = await fs.promises.readFile(presetPath, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (i < 20) { // Show first 20 lines
        console.log(chalk.gray(`  ${line}`));
      }
    });
    if (lines.length > 20) {
      console.log(chalk.gray(`  ... and ${lines.length - 20} more lines`));
    }
    return;
  }
  
  // Try to open in default editor
  const editor = process.env.EDITOR || 'nano';
  const { spawn } = await import('child_process');
  
  console.log(chalk.gray(`Opening ${presetPath} in ${editor}...`));
  const child = spawn(editor, [presetPath], { stdio: 'inherit' });
  
  child.on('exit', (code) => {
    if (code === 0) {
      console.log(chalk.green('✓ Preset edited successfully'));
    }
  });
}

/**
 * Preset command implementation
 */
export async function presetCommand(options: PresetOptions): Promise<void> {
  const projectPath = path.resolve(options.path || process.cwd());
  const presetsDir = getPresetsDir(projectPath);
  
  try {
    if (options.list || (!options.create && !options.info && !options.delete && !options.edit && !options.search)) {
      await listPresets(presetsDir);
    } else if (options.create) {
      await createPreset(options.create, projectPath);
    } else if (options.info) {
      await showPresetInfo(options.info, projectPath);
    } else if (options.delete) {
      await deletePreset(options.delete, projectPath);
    } else if (options.edit) {
      await editPreset(options.edit, projectPath);
    } else if (options.search) {
      await searchPresets(options.search, projectPath);
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}