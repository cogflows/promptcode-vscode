#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { generateCommand } from './commands/generate';
import { cacheCommand } from './commands/cache';
import { listTemplates } from './commands/templates';
import { presetCommand } from './commands/preset';
import { expertCommand } from './commands/expert';
import { configCommand } from './commands/config';
import { ccCommand } from './commands/cc';
import { BUILD_VERSION } from './version';

/**
 * Parse positional arguments to detect question and file patterns
 * Following o3-pro's recommendation for AI-agent friendly syntax
 */
function parsePositional(tokens: string[]): { question: string; patterns: string[] } {
  const patterns: string[] = [];
  const questionParts: string[] = [];
  let foundQuestion = false;
  
  // Check if first token is a quoted question
  if (tokens.length > 0 && (tokens[0].includes(' ') || tokens[0].endsWith('?'))) {
    foundQuestion = true;
    questionParts.push(tokens[0]);
    tokens = tokens.slice(1);
  }
  
  for (const token of tokens) {
    // Strip @ prefix if present (Gemini-style)
    const cleanToken = token.startsWith('@') ? token.slice(1) : token;
    
    // Check if token looks like a file/pattern
    const hasGlobChars = /[*?[\]{}]/.test(cleanToken);
    const existsAsFile = fs.existsSync(path.resolve(cleanToken));
    const hasPathSeparator = cleanToken.includes('/') || cleanToken.includes('\\');
    
    if (hasGlobChars || existsAsFile || hasPathSeparator) {
      patterns.push(cleanToken);
    } else if (!foundQuestion) {
      questionParts.push(token);
    }
  }
  
  const question = questionParts.join(' ').trim();
  return { question, patterns };
}

/**
 * Smart default command handler for zero-friction usage
 * Supports: promptcode "question" file1 file2...
 */
async function defaultCommand(args: string[], opts: any): Promise<void> {
  // If no args provided, check if they meant to use --help
  if (args.length === 0) {
    program.outputHelp();
    return;
  }
  
  // Parse positional arguments
  const { question, patterns } = parsePositional(args);
  
  // If we have a question, use expert mode
  if (question) {
    const expertOptions = {
      ...opts,
      files: patterns.length > 0 ? patterns : undefined,
      savePreset: opts.savePreset
    };
    await expertCommand(question, expertOptions);
  } 
  // If only files provided, generate prompt
  else if (patterns.length > 0) {
    const generateOptions = {
      ...opts,
      files: patterns,
      savePreset: opts.savePreset
    };
    await generateCommand(generateOptions);
  }
  // No clear intent, show helpful error
  else {
    console.error(chalk.red('🙋 I need either a question or file patterns to work with.\n'));
    console.error(chalk.yellow('Examples:'));
    console.error(chalk.gray('  promptcode "Why is this slow?" src/**/*.ts'));
    console.error(chalk.gray('  promptcode "Explain the auth flow" @backend/ @frontend/'));
    console.error(chalk.gray('  promptcode src/**/*.ts  # Just generate prompt\n'));
    console.error(chalk.gray('For more help: promptcode --help'));
    process.exit(1);
  }
}

const program = new Command()
  .name('promptcode')
  .description('Generate AI-ready prompts from codebases - designed for AI coding assistants')
  .version(BUILD_VERSION)
  .addHelpText('after', `
Quick Start (AI-Agent Friendly):
  $ promptcode "Why is this slow?" src/**/*.ts          # Ask AI about files
  $ promptcode "Explain the auth flow" @backend/ @api/  # @ prefix supported
  $ promptcode src/**/*.ts                              # Just generate prompt
  $ promptcode "Find bugs" src/**/*.ts --save-preset qa # Save patterns for reuse
  
Traditional Commands:
  $ promptcode generate -f "src/**/*.ts" -o prompt.md   # Generate prompt
  $ promptcode preset --create backend                   # Create preset
  $ promptcode expert "How to optimize this?" -p backend # Ask AI expert
  
Common Workflows:
  1. Zero-config usage:
     $ promptcode "What are the security risks?"        # Analyze entire project
     $ promptcode "Review this code" file1.py file2.js  # Specific files
  
  2. Expert consultation:
     $ promptcode config --set-openai-key sk-...
     $ promptcode expert "Explain the auth flow" --preset auth
  
  3. Apply AI changes:
     $ promptcode diff response.md --preview
     $ promptcode diff response.md --apply

For detailed help: promptcode <command> --help`);

// Generate command
program
  .command('generate')
  .description('Generate a prompt from selected files for AI analysis')
  .addHelpText('after', `
Examples:
  $ promptcode generate                      # All files in project
  $ promptcode generate -f "src/**/*.ts"     # Specific patterns
  $ promptcode generate -p backend           # Use preset
  $ promptcode generate -t code-review       # Apply template
  $ promptcode generate -p api -o prompt.md  # Save to file`)
  .option('-p, --preset <name>', 'use a preset (shorthand for -l)')
  .option('-f, --files <patterns...>', 'file glob patterns')
  .option('-l, --list <file>', 'file list or preset name (deprecated, use -p)')
  .option('-t, --template <name>', 'apply a template')
  .option('-i, --instructions <file>', 'custom instructions file')
  .option('-o, --out <file>', 'output file (default: stdout)')
  .option('--output <file>', 'output file (alias for --out)')
  .option('--json', 'output JSON with metadata')
  .option('--no-gitignore', 'ignore .gitignore rules')
  .option('--path <dir>', 'project directory', process.cwd())
  .option('--save-preset <name>', 'save file patterns as a preset')
  .option('--dry-run', 'show what would be included without generating')
  .option('--token-warning <n>', 'token threshold for warning (default: 50000)')
  .option('-y, --yes', 'skip confirmation prompts')
  .action(async (options) => {
    // Handle preset shorthand
    if (options.preset && !options.list) {
      options.list = options.preset;
    }
    await generateCommand(options);
  });

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

// Preset command - manage pattern presets
program
  .command('preset [action] [name]')
  .description('Manage file pattern presets for quick context switching')
  .addHelpText('after', `
Actions:
  list              List all presets (default)
  create <name>     Create a new preset
  info <name>       Show preset details and token count
  search <query>    Search presets by name or content
  edit <name>       Edit preset in your editor
  delete <name>     Delete a preset

Examples:
  $ promptcode preset list
  $ promptcode preset create backend
  $ promptcode preset info backend
  $ promptcode preset search "auth"
  $ promptcode generate -l backend

Legacy flags (still supported):
  $ promptcode preset --create backend
  $ promptcode preset --info backend`)
  .option('-p, --path <dir>', 'project root directory', process.cwd())
  .option('--list', 'list all presets (legacy)')
  .option('--create <name>', 'create a new preset (legacy)')
  .option('--info <name>', 'show preset info (legacy)')
  .option('--edit <name>', 'edit preset (legacy)')
  .option('--delete <name>', 'delete a preset (legacy)')
  .option('--search <query>', 'search presets (legacy)')
  .action(async (action, name, options) => {
    // Handle direct subcommand syntax
    if (action && ['list', 'create', 'info', 'edit', 'delete', 'search'].includes(action)) {
      if (action === 'list') {
        options.list = true;
      } else if (name) {
        options[action] = name;
      } else {
        console.error(chalk.red(`Error: ${action} requires a ${action === 'search' ? 'query' : 'preset name'}`));
        process.exit(1);
      }
    }
    // If no recognized action, treat first arg as legacy usage
    else if (action) {
      // Could be a preset name with --info flag, etc.
    }
    
    await presetCommand(options);
  });

// Expert command - consult AI with codebase context
program
  .command('expert [question]')
  .description('Ask AI expert questions with full codebase context')
  .addHelpText('after', `
Requires API key for chosen provider. Configure with:
  $ promptcode config --set-openai-key <key>     # For O3, O3 Pro
  $ promptcode config --set-anthropic-key <key>  # For Opus 4, Sonnet 4
  $ promptcode config --set-google-key <key>     # For Gemini 2.5 Pro
  $ promptcode config --set-xai-key <key>        # For Grok 4

Examples:
  $ promptcode expert "How can I optimize the API performance?"
  $ promptcode expert "Explain the authentication flow" --preset auth
  $ promptcode expert "Find potential security issues" -f "src/api/**/*.ts"
  $ promptcode expert "Review this code" --model opus-4 --stream
  $ promptcode expert --list-models  # See all available models`)
  .option('-p, --path <dir>', 'project root directory', process.cwd())
  .option('--preset <name>', 'use a preset for context')
  .option('-f, --files <patterns...>', 'file patterns to include')
  .option('--model <model>', 'AI model to use (use --list-models to see available options)')
  .option('--list-models', 'List available AI models')
  .option('-o, --output <file>', 'save response to file')
  .option('--stream', 'stream response in real-time')
  .option('--save-preset <name>', 'save file patterns as a preset')
  .option('--no-confirm', 'skip cost confirmation prompt')
  .option('-y, --yes', 'automatically confirm (alias for --no-confirm)')
  .action(async (question, options) => {
    await expertCommand(question, options);
  });

// Config command - manage configuration
program
  .command('config')
  .description('Manage PromptCode configuration')
  .option('--show', 'show current configuration')
  .option('--set-openai-key <key>', 'set OpenAI API key')
  .option('--set-anthropic-key <key>', 'set Anthropic API key')
  .option('--set-google-key <key>', 'set Google API key')
  .option('--set-xai-key <key>', 'set xAI API key')
  .option('--reset', 'reset all configuration')
  .action(async (options) => {
    await configCommand(options);
  });

// CC command - Claude integration setup
program
  .command('cc')
  .description('Set up or remove Claude AI integration (.claude folder)')
  .addHelpText('after', `
This command creates a .claude folder with:
  - CLAUDE.md: Instructions for AI agents using promptcode
  - .env.example: Template for API keys
  - commands/: Directory for Claude-specific commands

The .claude folder is automatically detected in current or parent directory (for monorepos).

Examples:
  $ promptcode cc              # Set up Claude integration
  $ promptcode cc --force      # Recreate/update existing setup
  $ promptcode cc --uninstall  # Remove Claude integration`)
  .option('-p, --path <dir>', 'project root directory', process.cwd())
  .option('--force', 'update existing structure / skip confirmation prompts')
  .option('-y, --yes', 'alias for --force (CI-friendly)')
  .option('--uninstall', 'remove Claude integration (asks for confirmation)')
  .action(async (options) => {
    await ccCommand(options);
  });

// Stats command (quick stats about current directory)
program
  .command('stats')
  .description('Show token statistics for current project or preset')
  .option('-p, --path <dir>', 'project root directory', process.cwd())
  .option('-l, --preset <name>', 'analyze a specific preset')
  .addHelpText('after', '\nShows file count, total tokens, and breakdown by file type.')
  .action(async (options) => {
    const { scanFiles, initializeTokenCounter } = await import('@promptcode/core');
    const ora = (await import('ora')).default;
    const path = await import('path');
    
    const useSpinner = process.stdout.isTTY && !process.env.PROMPTCODE_TEST;
    const spinner = useSpinner ? ora('Analyzing project...').start() : null;
    
    try {
      // Initialize token counter
      const cacheDir = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '', '.cache', 'promptcode');
      initializeTokenCounter(cacheDir, '0.1.0');
      
      const projectPath = path.resolve(options.path);
      
      // Determine patterns
      let patterns = ['**/*'];
      if (options.preset) {
        const presetPath = path.join(projectPath, '.promptcode', 'presets', `${options.preset}.patterns`);
        if (fs.existsSync(presetPath)) {
          const content = await fs.promises.readFile(presetPath, 'utf8');
          patterns = content
            .split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => line && !line.startsWith('#'));
        } else {
          if (spinner) spinner.fail(`Preset not found: ${options.preset}`);
          else console.error(chalk.red(`Preset not found: ${options.preset}`));
          return;
        }
      }
      
      // Scan files
      const files = await scanFiles({
        cwd: projectPath,
        patterns,
        respectGitignore: true,
        workspaceName: path.basename(projectPath)
      });
      
      if (spinner) spinner.stop();
      
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
      const title = options.preset 
        ? `Preset Statistics: ${chalk.cyan(options.preset)}`
        : `Project Statistics: ${chalk.cyan(path.basename(projectPath))}`;
      
      console.log(chalk.bold(`\n${title}`));
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
      
      // Force exit in test mode
      if (process.env.PROMPTCODE_TEST === '1') {
        process.exit(0);
      }
      
    } catch (error) {
      if (spinner) spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
      else console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Diff command - compare prompt output with actual file changes
program
  .command('diff <prompt-file>')
  .description('Compare AI-suggested changes with actual files')
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
  .option('--json', 'output diff as JSON for programmatic use')
  .action(async (promptFile, options) => {
    const { diffCommand } = await import('./commands/diff');
    await diffCommand(promptFile, options);
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

// History command - view and manage command history
program
  .command('history')
  .description('View recent command history and convert to presets')
  .addHelpText('after', `
Examples:
  $ promptcode history                      # List recent entries
  $ promptcode history --limit 20           # Show more entries
  $ promptcode history --show 5             # Show full details of entry #5
  $ promptcode history --preset 5 my-preset # Convert entry #5 to preset`)
  .option('--limit <n>', 'number of entries to show', '10')
  .option('--show <index>', 'show full details of specific entry')
  .option('--preset <index>', 'convert entry to preset (requires --name)')
  .option('--name <name>', 'preset name when converting from history')
  .option('--json', 'output as JSON')
  .action(async (options) => {
    const { historyCommand } = await import('./commands/history');
    await historyCommand(options);
  });

// Version info command - show detailed version information
program
  .command('version-info')
  .description('Show detailed version and build information')
  .action(() => {
    console.log(chalk.bold('PromptCode CLI'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Version: ${chalk.cyan(BUILD_VERSION)}`);
    
    // Parse version to show build info
    if (BUILD_VERSION.includes('-dev.')) {
      const parts = BUILD_VERSION.split('-dev.');
      const [date, hash] = parts[1].split('.');
      console.log(`Build type: ${chalk.yellow('Development')}`);
      console.log(`Build date: ${chalk.gray(date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8))}`);
      console.log(`Git commit: ${chalk.gray(hash)}`);
    } else {
      console.log(`Build type: ${chalk.green('Production')}`);
    }
    
    console.log(`Node.js: ${chalk.gray(process.version)}`);
    console.log(`Platform: ${chalk.gray(process.platform + ' ' + process.arch)}`);
  });

// Add global options that work with the default command
program
  .option('--save-preset <name>', 'save file patterns as a preset for later use');

// Handle smart routing for zero-friction usage
// Check if we should use the default command handler
const args = process.argv.slice(2);
const hasSubcommand = args.length > 0 && [
  'generate', 'cache', 'templates', 'list-templates', 'preset', 
  'expert', 'config', 'cc', 'stats', 'diff', 'watch', 'validate', 
  'extract', 'version-info', 'history', '--help', '-h', '--version', '-V'
].includes(args[0]);

if (!hasSubcommand && args.length > 0) {
  // Parse options for default command
  const savePresetIndex = args.indexOf('--save-preset');
  let savePreset;
  let filteredArgs = args;
  
  if (savePresetIndex !== -1 && args[savePresetIndex + 1]) {
    savePreset = args[savePresetIndex + 1];
    // Remove --save-preset and its value from args
    filteredArgs = args.filter((_, i) => i !== savePresetIndex && i !== savePresetIndex + 1);
  }
  
  // Use smart default command for zero-friction usage
  defaultCommand(filteredArgs, { savePreset })
    .then(() => {
      // Exit cleanly after command completes
      if (process.env.PROMPTCODE_TEST === '1') {
        process.exit(0);
      }
    })
    .catch(err => {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    });
} else {
  // Parse normally for traditional commands
  program.parse();
}