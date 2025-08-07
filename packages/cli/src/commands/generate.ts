import * as path from 'path';
import * as fs from 'fs';
import { scanFiles, buildPrompt, initializeTokenCounter } from '@promptcode/core';
import chalk from 'chalk';
import ora from 'ora';
import { logRun } from '../services/history';
import { 
  getCacheDir,
  resolveProjectPath,
  CACHE_VERSION,
  IGNORE_FILE_NAME,
  loadInstructionsFromOptions,
  getPatternsFromOptions,
  handlePresetSave,
  outputResults
} from '../utils';
import { 
  shouldShowSpinner,
  getTokenThreshold,
  shouldSkipConfirmation,
  isInteractive,
  exitInTestMode
} from '../utils/environment';

export interface GenerateOptions {
  path?: string;
  files?: string[];
  ignoreGitignore?: boolean;
  instructions?: string;
  template?: string;
  out?: string;
  output?: string;  // Alias for --out
  json?: boolean;
  ignoreFile?: string;
  list?: string;
  preset?: string;  // Load patterns from preset
  savePreset?: string;
  dryRun?: boolean;
  tokenWarning?: number;
  yes?: boolean;
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  // Don't use spinner in non-TTY environments (tests, CI)
  const spinner = shouldShowSpinner(options) ? ora('Initializing...').start() : null;
  
  try {
    // Initialize and validate
    initializeTokenCounter(getCacheDir(), CACHE_VERSION);
    const projectPath = resolveProjectPath(options.path);
    
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }
    
    // Load configuration
    if (spinner) spinner.text = 'Loading configuration...';
    
    const instructions = await loadInstructionsFromOptions(options);
    
    // Handle output alias
    if (options.output && !options.out) {
      options.out = options.output;
    }
    
    // Get patterns from preset or options
    let patterns: string[];
    if (options.preset) {
      // Load preset patterns
      const presetPath = path.join(projectPath, '.promptcode', 'presets', `${options.preset}.patterns`);
      if (fs.existsSync(presetPath)) {
        const content = await fs.promises.readFile(presetPath, 'utf8');
        patterns = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        
        if (!options.json) {
          console.log(chalk.gray(`📋 Using preset: ${options.preset}`));
        }
      } else {
        throw new Error(`Preset not found: ${options.preset}\nCreate it with: promptcode preset --create ${options.preset}`);
      }
    } else {
      patterns = await getPatternsFromOptions(options, projectPath);
    }
    
    // Save preset if requested
    if (options.savePreset && patterns.length > 0) {
      await handlePresetSave(options.savePreset, patterns, projectPath, options.json);
    }
    
    // Scan files
    if (spinner) spinner.text = 'Scanning files...';
    
    const selectedFiles = await scanFiles({
      cwd: projectPath,
      patterns,
      respectGitignore: !options.ignoreGitignore,
      customIgnoreFile: options.ignoreFile || path.join(projectPath, IGNORE_FILE_NAME),
      workspaceName: path.basename(projectPath)
    });
    
    if (selectedFiles.length === 0) {
      throw new Error('No files found matching the specified patterns');
    }
    
    // Calculate total tokens for dry run or warning
    const totalTokens = selectedFiles.reduce((sum, f) => sum + f.tokenCount, 0);
    
    // Dry run mode - just show what would be included
    if (options.dryRun) {
      if (spinner) spinner.stop();
      
      console.log(chalk.bold('Dry run - files that would be included:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Files: ${chalk.cyan(selectedFiles.length)}`);
      console.log(`Total tokens: ${chalk.cyan(totalTokens.toLocaleString())}`);
      
      // Group by extension
      const byExt: Record<string, number> = {};
      selectedFiles.forEach(f => {
        const ext = path.extname(f.path) || '(no extension)';
        byExt[ext] = (byExt[ext] || 0) + 1;
      });
      
      console.log('\nFile types:');
      Object.entries(byExt)
        .sort((a, b) => b[1] - a[1])
        .forEach(([ext, count]) => {
          console.log(`  ${ext.padEnd(15)} ${chalk.gray(count + ' files')}`);
        });
      
      console.log('\nTop 10 files by tokens:');
      selectedFiles
        .sort((a, b) => b.tokenCount - a.tokenCount)
        .slice(0, 10)
        .forEach(f => {
          const relPath = path.relative(projectPath, f.path);
          console.log(`  ${relPath.padEnd(50)} ${chalk.gray(f.tokenCount.toLocaleString() + ' tokens')}`);
        });
      
      return;
    }
    
    // Token warning threshold check
    const threshold = getTokenThreshold(options);
    
    if (totalTokens > threshold && !shouldSkipConfirmation(options)) {
      if (spinner) spinner.stop();
      
      // Estimate cost (rough approximation)
      const estimatedCost = (totalTokens / 1000000) * 5; // Assuming ~$5 per million tokens
      
      console.log(chalk.yellow(`\n⚠️  Large prompt detected:`));
      console.log(`   Files: ${selectedFiles.length}`);
      console.log(`   Tokens: ${chalk.bold(totalTokens.toLocaleString())}`);
      console.log(`   Estimated cost: ~$${estimatedCost.toFixed(2)}`);
      
      // Check if interactive
      if (!isInteractive()) {
        console.log(chalk.yellow('\nNon-interactive environment. Use --yes to proceed without confirmation.'));
        process.exit(1);
      }
      
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.bold('\nProceed? (y/N): '), resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('\nCancelled.'));
        process.exit(0);
      }
      
      if (spinner) spinner.start('Building prompt...');
    }
    
    // Build prompt
    if (spinner) spinner.text = `Building prompt for ${selectedFiles.length} files...`;
    
    const result = await buildPrompt(selectedFiles, instructions, {
      includeFiles: true,
      includeInstructions: !!instructions,
      includeFileContents: true
    });
    
    if (spinner) spinner.succeed(`Generated prompt with ${result.tokenCount} tokens`);
    
    // Log and output
    await logRun('generate', patterns, projectPath, {
      fileCount: selectedFiles.length,
      tokenCount: result.tokenCount
    });
    
    await outputResults(result, selectedFiles, options);
    
    // Force exit in test mode to prevent hanging
    exitInTestMode(0);
    
  } catch (error) {
    if (spinner) spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
    else if (!options.json) console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}