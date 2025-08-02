import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { watch } from 'chokidar';
import { scanFiles, buildPrompt, SelectedFile } from '@promptcode/core';
import { debounce } from '../utils/debounce';

interface WatchOptions {
  path: string;
  files?: string[];
  out?: string;
  template?: string;
  debounce: string;
}

export async function watchCommand(options: WatchOptions) {
  const patterns = options.files || ['**/*'];
  const debounceMs = parseInt(options.debounce) || 1000;
  
  console.log(chalk.bold('Starting file watcher...'));
  console.log(chalk.gray(`Watching: ${patterns.join(', ')}`));
  console.log(chalk.gray(`Output: ${options.out || 'stdout'}`));
  console.log(chalk.gray(`Debounce: ${debounceMs}ms\n`));
  
  let isGenerating = false;
  
  const regeneratePrompt = async () => {
    if (isGenerating) return;
    isGenerating = true;
    
    const spinner = chalk.cyan('⟳');
    process.stdout.write(`${spinner} Regenerating prompt...`);
    
    try {
      // Scan files
      const files = await scanFiles({
        cwd: options.path,
        patterns,
        respectGitignore: true,
        workspaceName: path.basename(options.path)
      });
      
      // Load instructions/template
      let instructions = '';
      if (options.template) {
        // Load template (simplified for now)
        instructions = `Using template: ${options.template}`;
      }
      
      // Build prompt
      const result = await buildPrompt(files, instructions, {
        includeMap: true,
        xml: true
      });
      
      // Clear the spinner line
      process.stdout.write('\r\x1b[K');
      
      if (options.out) {
        await fs.writeFile(options.out, result.prompt, 'utf-8');
        console.log(chalk.green(`✓ Updated ${options.out} (${result.totalTokens.toLocaleString()} tokens)`));
      } else {
        console.log(chalk.gray('--- Generated Prompt ---'));
        console.log(result.prompt);
        console.log(chalk.gray(`--- End (${result.totalTokens.toLocaleString()} tokens) ---\n`));
      }
      
    } catch (error) {
      process.stdout.write('\r\x1b[K');
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    } finally {
      isGenerating = false;
    }
  };
  
  // Create debounced version
  const debouncedRegenerate = debounce(regeneratePrompt, debounceMs);
  
  // Initial generation
  await regeneratePrompt();
  
  // Set up watcher
  const watcher = watch(patterns, {
    cwd: options.path,
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      options.out || '' // Don't watch the output file
    ],
    persistent: true,
    ignoreInitial: true
  });
  
  watcher
    .on('add', (filePath) => {
      console.log(chalk.yellow(`+ ${filePath}`));
      debouncedRegenerate();
    })
    .on('change', (filePath) => {
      console.log(chalk.blue(`~ ${filePath}`));
      debouncedRegenerate();
    })
    .on('unlink', (filePath) => {
      console.log(chalk.red(`- ${filePath}`));
      debouncedRegenerate();
    })
    .on('error', (error) => {
      console.error(chalk.red(`Watcher error: ${error.message}`));
    });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.gray('\n\nStopping watcher...'));
    watcher.close();
    process.exit(0);
  });
  
  console.log(chalk.gray('Press Ctrl+C to stop watching\n'));
}