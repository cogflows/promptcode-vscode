#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { generateCommand } from './commands/generate';
import { cacheCommand } from './commands/cache';
import { listTemplates } from './commands/templates';

const program = new Command()
  .name('promptcode')
  .description('Generate AI-ready prompts from codebases - designed for AI coding assistants')
  .version('0.1.0')
  .addHelpText('after', `
Common AI Agent Workflow:
  $ promptcode context add "src/**/*.ts"          # 1. Add files to context
  $ promptcode generate -o prompt.md              # 2. Generate prompt
  $ # ... AI generates response.md ...
  $ promptcode diff response.md --preview         # 3. Preview changes
  $ promptcode diff response.md --apply           # 4. Apply changes
  
Quick Examples:
  $ promptcode generate                    # Generate prompt from all files
  $ promptcode generate -f "src/**/*.ts"   # Generate from TypeScript files
  $ promptcode extract response.md         # Extract code from AI response
  $ promptcode validate generated.ts       # Validate AI-generated code
  
For detailed help on any command, use: promptcode <command> --help`);

// Generate command
program
  .command('generate')
  .description('Generate a prompt from selected files for AI analysis')
  .addHelpText('after', `
Examples:
  $ promptcode generate -f "src/**/*.ts" -o prompt.md
  $ promptcode generate -t code-review --json
  $ promptcode generate -i instructions.md`)
  .option('-p, --path <dir>', 'project root directory', process.cwd())
  .option('-f, --files <patterns...>', 'file glob patterns (e.g., "src/**/*.ts" "!**/*.test.ts")')
  .option('--no-gitignore', 'ignore .gitignore rules')
  .option('--ignore-file <file>', 'path to custom ignore file (default: .promptcode_ignore)')
  .option('-l, --list <file>', 'read file paths from a text file (one per line)')
  .option('-i, --instructions <file>', 'path to markdown/text instructions file')
  .option('-t, --template <name>', 'use a built-in or user template')
  .option('-o, --out <file>', 'output file (default: stdout)')
  .option('--json', 'output in JSON format with metadata')
  .action(generateCommand);

// Cache command
program
  .command('cache <action>')
  .description('Manage token count cache for performance (actions: clear, stats)')
  .addHelpText('before', '\nActions:\n  clear - Remove all cached token counts\n  stats - Show cache statistics and size')
  .action(cacheCommand);

// Templates command
program
  .command('templates')
  .alias('list-templates')
  .description('List available prompt templates')
  .action(listTemplates);

// Stats command (quick stats about current directory)
program
  .command('stats')
  .description('Show token statistics about the current project')
  .option('-p, --path <dir>', 'project root directory', process.cwd())
  .addHelpText('after', '\nShows file count, total tokens, and breakdown by file type.')
  .action(async (options) => {
    const { scanFiles, initializeTokenCounter } = await import('@promptcode/core');
    const ora = (await import('ora')).default;
    const path = await import('path');
    
    const spinner = ora('Analyzing project...').start();
    
    try {
      // Initialize token counter
      const cacheDir = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '', '.cache', 'promptcode');
      initializeTokenCounter(cacheDir, '0.1.0');
      
      const projectPath = path.resolve(options.path);
      
      // Scan all files
      const files = await scanFiles({
        cwd: projectPath,
        patterns: ['**/*'],
        respectGitignore: true,
        workspaceName: path.basename(projectPath)
      });
      
      spinner.stop();
      
      // Calculate statistics
      const totalTokens = files.reduce((sum, f) => sum + f.tokenCount, 0);
      const filesByExt: Record<string, { count: number; tokens: number }> = {};
      
      for (const file of files) {
        const ext = path.extname(file.path) || '(no extension)';
        if (!filesByExt[ext]) {
          filesByExt[ext] = { count: 0, tokens: 0 };
        }
        filesByExt[ext].count++;
        filesByExt[ext].tokens += file.tokenCount;
      }
      
      // Display results
      console.log(chalk.bold(`\nProject Statistics: ${chalk.cyan(path.basename(projectPath))}`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Total files: ${chalk.cyan(files.length)}`);
      console.log(`Total tokens: ${chalk.cyan(totalTokens.toLocaleString())}`);
      console.log(`Average tokens/file: ${chalk.cyan(Math.round(totalTokens / files.length).toLocaleString())}`);
      
      console.log(chalk.bold('\nTop file types by token count:'));
      const sortedExts = Object.entries(filesByExt)
        .sort((a, b) => b[1].tokens - a[1].tokens)
        .slice(0, 10);
        
      for (const [ext, stats] of sortedExts) {
        const percentage = ((stats.tokens / totalTokens) * 100).toFixed(1);
        console.log(`  ${ext.padEnd(15)} ${chalk.cyan(stats.count.toString().padStart(5))} files  ${chalk.cyan(stats.tokens.toLocaleString().padStart(10))} tokens  ${chalk.gray(`(${percentage}%)`)}`);
      }
      
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Diff command - compare prompt output with actual file changes
program
  .command('diff <prompt-file>')
  .description('Compare AI-suggested changes with actual files')
  .argument('<prompt-file>', 'path to AI response file (markdown/JSON)')
  .addHelpText('after', `
This command extracts code blocks from AI responses and shows diffs.

Examples:
  $ promptcode diff ai-response.md                # Show diff summary
  $ promptcode diff ai-response.md --preview      # Show full diff
  $ promptcode diff ai-response.json --apply      # Apply changes

Code blocks should include filename in header or first comment:
  \`\`\`typescript // src/index.ts
  or
  \`\`\`ts
  // filename: src/index.ts`)
  .option('-p, --path <dir>', 'project root directory', process.cwd())
  .option('--apply', 'apply the changes to files')
  .option('--preview', 'show preview of changes without applying')
  .action(async (promptFile, options) => {
    const { diffCommand } = await import('./commands/diff');
    await diffCommand(promptFile, options);
  });

// Context command - add/remove files from current context
program
  .command('context <action> [files...]')
  .description('Manage persistent file context for AI sessions')
  .argument('<action>', 'action to perform')
  .argument('[files...]', 'file paths or glob patterns')
  .addHelpText('after', `
Actions:
  add [files...]    - Add files to context
  remove [files...] - Remove files from context (alias: rm)
  list              - Show current context (alias: ls)
  clear             - Clear all context
  save              - Save current context (requires --save <name>)
  load              - Load saved context (requires --load <name>)
  saved             - List all saved contexts

Examples:
  $ promptcode context add "src/**/*.ts"
  $ promptcode context list
  $ promptcode context save --save feature-x
  $ promptcode context load --load feature-x`)
  .option('-p, --path <dir>', 'project root directory', process.cwd())
  .option('--save <name>', 'save context as a named selection')
  .option('--load <name>', 'load a saved context selection')
  .action(async (action, files, options) => {
    const { contextCommand } = await import('./commands/context');
    await contextCommand(action, files, options);
  });

// Watch command - monitor files and regenerate prompt on changes
program
  .command('watch')
  .description('Watch files and regenerate prompt on changes')
  .addHelpText('after', `
Examples:
  $ promptcode watch -f "src/**/*.ts" -o context.md
  $ promptcode watch -t code-review --debounce 2000`)
  .option('-p, --path <dir>', 'project root directory', process.cwd())
  .option('-f, --files <patterns...>', 'file glob patterns to watch')
  .option('-o, --out <file>', 'output file to update')
  .option('-t, --template <name>', 'template to use')
  .option('--debounce <ms>', 'debounce time in milliseconds', '1000')
  .action(async (options) => {
    const { watchCommand } = await import('./commands/watch');
    await watchCommand(options);
  });

// Validate command - check if generated code matches constraints
program
  .command('validate')
  .description('Validate AI-generated code against security and quality rules')
  .argument('<file>', 'file containing AI-generated code')
  .addHelpText('after', `
Built-in checks:
  - No console.log statements
  - No debugger statements
  - No exposed API keys/secrets
  - No private keys
  - TODO comment detection

Examples:
  $ promptcode validate response.md
  $ promptcode validate code.ts --fix
  $ promptcode validate response.md --rules .promptcode/rules.json`)
  .option('--rules <file>', 'custom validation rules file')
  .option('--fix', 'attempt to auto-fix issues')
  .action(async (file, options) => {
    const { validateCommand } = await import('./commands/validate');
    await validateCommand(file, options);
  });

// Extract command - extract code blocks from AI responses
program
  .command('extract')
  .description('Extract code blocks from AI response files')
  .argument('<response-file>', 'markdown/text file with code blocks')
  .addHelpText('after', `
Examples:
  $ promptcode extract response.md                         # List code blocks
  $ promptcode extract response.md --lang typescript       # Filter by language
  $ promptcode extract response.md --save-dir ./generated  # Save to files
  $ promptcode extract response.md --stdout > code.ts      # Output to stdout`)
  .option('--lang <language>', 'filter by language (e.g., typescript, python)')
  .option('--save-dir <dir>', 'directory to save extracted files')
  .option('--stdout', 'output to stdout instead of files')
  .action(async (responseFile, options) => {
    const { extractCommand } = await import('./commands/extract');
    await extractCommand(responseFile, options);
  });

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}