import * as path from 'path';
import * as fs from 'fs';
import { scanFiles, buildPrompt, initializeTokenCounter } from '@promptcode/core';
import chalk from 'chalk';
import { logRun } from '../services/history';
import { 
  getCacheDir,
  resolveProjectPath,
  CACHE_VERSION,
  IGNORE_FILE_NAME,
  loadInstructionsFromOptions,
  getPatternsFromOptions,
  handlePresetSave,
  outputResults,
  getPresetPath,
  getProjectRoot
} from '../utils';
import { validatePatterns } from '../utils/validation';
import { 
  getTokenThreshold,
  shouldSkipConfirmation,
  isInteractive,
  exitInTestMode
} from '../utils/environment';
import { spinner } from '../utils/spinner';
import { estimateCost, formatCost } from '../utils/cost';
import { EXIT_CODES, exitWithCode } from '../utils/exit-codes';
import { DEFAULT_MODEL } from '../providers/models';

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
  estimateCost?: boolean;
  costThreshold?: string;
  model?: string;  // For cost estimation
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  // Use our wrapped spinner that handles cleanup
  const spin = spinner();
  spin.start('Initializing...');
  
  try {
    // Initialize and validate
    initializeTokenCounter(getCacheDir(), CACHE_VERSION);
    const projectPath = resolveProjectPath(options.path);
    
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }
    
    // Load configuration
    spin.text = 'Loading configuration...';
    
    const instructions = await loadInstructionsFromOptions(options);
    
    // Handle output alias
    if (options.output && !options.out) {
      options.out = options.output;
    }
    
    // Get patterns from preset or options
    let patterns: string[];
    if (options.preset) {
      // Load preset patterns using helper
      const presetPath = getPresetPath(projectPath, options.preset);
        
      if (fs.existsSync(presetPath)) {
        const content = await fs.promises.readFile(presetPath, 'utf8');
        patterns = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        
        if (!options.json && !options.dryRun) {
          console.log(chalk.gray(`📋 Using preset: ${options.preset}`));
        }
      } else {
        throw new Error(`Preset not found: ${options.preset}\nCreate it with: promptcode preset --create ${options.preset}`);
      }
    } else {
      patterns = await getPatternsFromOptions(options, projectPath);
    }
    
    // Validate patterns for security
    validatePatterns(patterns);
    
    // Save preset if requested
    if (options.savePreset && patterns.length > 0) {
      await handlePresetSave(options.savePreset, patterns, projectPath, options.json);
    }
    
    // Scan files
    spin.text = 'Scanning files...';
    
    // Separate absolute paths from relative patterns
    const absolutePaths = patterns.filter(p => path.isAbsolute(p));
    const relativePatterns = patterns.filter(p => !path.isAbsolute(p));
    
    // Use project root for scanning (where preset patterns are relative to)
    const scanRoot = getProjectRoot(projectPath);
    
    // Scan relative patterns normally
    let selectedFiles = relativePatterns.length > 0 ? await scanFiles({
      cwd: scanRoot,
      patterns: relativePatterns,
      respectGitignore: !options.ignoreGitignore,
      customIgnoreFile: options.ignoreFile || path.join(scanRoot, IGNORE_FILE_NAME),
      workspaceName: path.basename(scanRoot),
      followSymlinks: false  // Security: don't follow symlinks
    }) : [];
    
    // Handle absolute paths directly
    if (absolutePaths.length > 0) {
      const { countTokensWithCacheDetailed } = await import('@promptcode/core');
      for (const absPath of absolutePaths) {
        try {
          // Check if file exists
          if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
            const { count: tokenCount } = await countTokensWithCacheDetailed(absPath);
            // For absolute paths, use just the filename as the "relative" path
            // This prevents buildPrompt from skipping them
            selectedFiles.push({
              path: path.basename(absPath),
              absolutePath: absPath,
              tokenCount,
              workspaceFolderRootPath: path.dirname(absPath),
              workspaceFolderName: 'external'
            });
          }
        } catch (err) {
          // Skip files that can't be read
          console.warn(chalk.gray(`Skipping unreadable file: ${absPath}`));
        }
      }
    }
    
    if (selectedFiles.length === 0) {
      throw new Error('No files found matching the specified patterns');
    }
    
    // Check for files outside project root (informational warning)
    // Use the actual project root (where .promptcode lives) for the check
    const projectRoot = fs.realpathSync(scanRoot) + path.sep;
    const externalFiles = selectedFiles.filter((f) => {
      try {
        const realPath = fs.realpathSync(f.absolutePath || f.path);
        return !realPath.startsWith(projectRoot);
      } catch {
        // If realpath fails (e.g., broken symlink), count as external
        return true;
      }
    });
    
    if (externalFiles.length > 0 && !options.json) {
      console.warn(chalk.yellow(`\n⚠️  Note: Including ${externalFiles.length} file(s) from outside the project directory`));
      if (process.env.VERBOSE || options.dryRun) {
        console.warn(chalk.gray('   External files:'));
        externalFiles.forEach(f => {
          const relPath = path.relative(projectPath, f.absolutePath || f.path);
          console.warn(chalk.gray(`   - ${relPath}`));
        });
      }
    }
    
    // Calculate total tokens for dry run or warning
    const totalTokens = selectedFiles.reduce((sum, f) => sum + f.tokenCount, 0);
    
    // Dry run mode - just show what would be included
    if (options.dryRun) {
      spin.stop();
      
      if (options.json) {
        // Output JSON format for dry run
        const output = {
          dryRun: true,
          fileCount: selectedFiles.length,
          tokenCount: totalTokens,
          files: selectedFiles.map(f => ({
            path: path.relative(projectPath, f.path),
            tokens: f.tokenCount
          }))
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        // Regular human-readable output
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
      }
      
      return;
    }
    
    // Cost estimation and threshold checking
    const modelKey = options.model || DEFAULT_MODEL;
    const expectedCompletion = 4000; // Default expected completion tokens
    const estimatedTotalCost = estimateCost(modelKey, totalTokens, expectedCompletion);
    
    // Handle --estimate-cost flag
    if (options.estimateCost) {
      spin.stop();
      
      if (options.json) {
        const output = {
          model: modelKey,
          inputTokens: totalTokens,
          expectedCompletionTokens: expectedCompletion,
          estimatedCost: estimatedTotalCost,
          estimatedCostFormatted: formatCost(estimatedTotalCost),
          fileCount: selectedFiles.length
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(chalk.bold('\nCost Estimation:'));
        console.log(`Model: ${chalk.cyan(modelKey)}`);
        console.log(`Input tokens: ${chalk.cyan(totalTokens.toLocaleString())}`);
        console.log(`Expected completion: ${chalk.cyan(expectedCompletion.toLocaleString())}`);
        console.log(`Estimated cost: ${chalk.yellow(formatCost(estimatedTotalCost))}`);
      }
      return;
    }
    
    // Determine cost threshold
    const costThreshold = options.costThreshold 
      ? parseFloat(options.costThreshold)
      : parseFloat(process.env.PROMPTCODE_COST_THRESHOLD || '0.50');
    
    // Check cost threshold
    if (estimatedTotalCost > costThreshold) {
      spin.stop();
      
      if (!options.json) {
        console.log(chalk.yellow(`\n⚠️  Cost threshold check:`));
        console.log(`   Estimated cost: ${chalk.bold(formatCost(estimatedTotalCost))}`);
        console.log(`   Threshold: ${chalk.bold(formatCost(costThreshold))}`);
        console.log(`   Files: ${selectedFiles.length}`);
        console.log(`   Tokens: ${totalTokens.toLocaleString()}`);
      }
      
      if (!shouldSkipConfirmation(options)) {
        // Check if interactive
        if (!isInteractive()) {
          if (options.json) {
            console.log(JSON.stringify({
              error: 'Cost approval required',
              errorCode: 'APPROVAL_REQUIRED',
              estimatedCost: estimatedTotalCost,
              costThreshold,
              message: 'Use --yes to proceed without confirmation in non-interactive mode'
            }));
          } else {
            console.log(chalk.yellow('\nNon-interactive environment detected.'));
            console.log('Cost approval required. Use --yes to proceed without confirmation.');
          }
          exitWithCode(EXIT_CODES.APPROVAL_REQUIRED);
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
          console.log(chalk.gray('\nCancelled by user.'));
          exitWithCode(EXIT_CODES.OPERATION_CANCELLED);
        }
      }
      
      spin.start('Building prompt...');
    }
    
    // Legacy token warning check (kept for backward compatibility)
    const tokenThreshold = getTokenThreshold(options);
    if (totalTokens > tokenThreshold && !options.costThreshold && !shouldSkipConfirmation(options)) {
      spin.stop();
      
      console.log(chalk.yellow(`\n⚠️  Large prompt detected (${totalTokens.toLocaleString()} tokens)`));
      console.log(`Estimated cost: ${formatCost(estimatedTotalCost)}`);
      
      if (!isInteractive()) {
        console.log(chalk.yellow('Use --yes to proceed without confirmation.'));
        process.exit(1);
      }
      
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.bold('Proceed? (y/N): '), resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('Cancelled.'));
        process.exit(0);
      }
      
      spin.start('Building prompt...');
    }
    
    // Build prompt
    spin.text = `Building prompt for ${selectedFiles.length} files...`;
    
    const result = await buildPrompt(selectedFiles, instructions, {
      includeFiles: true,
      includeInstructions: !!instructions,
      includeFileContents: true
    });
    
    if (!options.json) {
      spin.succeed(`Generated prompt with ${result.tokenCount} tokens`);
    } else {
      spin.stop(); // Just stop silently in JSON mode
    }
    
    // Log and output
    await logRun('generate', patterns, projectPath, {
      fileCount: selectedFiles.length,
      tokenCount: result.tokenCount
    });
    
    await outputResults(result, selectedFiles, options);
    
    // Force exit in test mode to prevent hanging
    exitInTestMode(0);
    
  } catch (error) {
    spin.fail(chalk.red(`Error: ${(error as Error).message}`));
    spin.stop(); // Ensure cleanup
    if (!options.json) {console.error(chalk.red(`Error: ${(error as Error).message}`));}
    process.exit(1);
  }
}