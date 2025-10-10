#!/usr/bin/env bun

// Minimal polyfills for Bun TTY compatibility
import './polyfills';

// IMPORTANT: This must be the second import/execution
// It handles pending update finalization before any other initialization
import { finalizeUpdateIfNeeded } from './early-update';
finalizeUpdateIfNeeded();

// Clean up the re-exec marker to prevent accidental propagation to subprocesses
delete process.env.PROMPTCODE_REEXEC_DEPTH;

// Now load the rest of the CLI
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
import { cursorCommand } from './commands/cursor';
import { updateCommand } from './commands/update';
import { uninstallCommand } from './commands/uninstall';
import { integrateCommand } from './commands/integrate';
import { modelsCommand } from './commands/models';
import { BUILD_VERSION } from './version';
import { startUpdateCheck } from './utils/update-checker';
import { exitWithCode, EXIT_CODES } from './utils/exit-codes';


/**
 * Show error for invalid command usage
 */
function showHelpOrError(args: string[]): void {
  // Show error for invalid usage
  console.error(chalk.red(`Error: Invalid usage. Please specify a command.\n`));
  console.error(chalk.yellow('Available commands:'));
  console.error(chalk.gray('  generate   - Generate a prompt from selected files'));
  console.error(chalk.gray('  expert     - Ask AI experts questions with code context'));
  console.error(chalk.gray('  preset     - Manage file pattern presets'));
  console.error(chalk.gray('  cc         - Set up Claude Code integration'));
  console.error(chalk.gray('  cursor     - Set up Cursor IDE/CLI integration'));
  console.error(chalk.gray('  stats      - Show codebase statistics'));
  console.error(chalk.gray('  update     - Update the CLI to latest version\n'));
  console.error(chalk.yellow('Examples:'));
  console.error(chalk.gray('  promptcode generate -f "src/**/*.ts"'));
  console.error(chalk.gray('  promptcode expert "Why is this slow?" -f "src/**/*.ts"'));
  console.error(chalk.gray('  promptcode preset create backend\n'));
  console.error(chalk.gray('For more help: promptcode --help'));
  exitWithCode(EXIT_CODES.INVALID_INPUT);
}

const program = new Command()
  .name('promptcode')
  .description('Generate AI-ready prompts from codebases - designed for AI coding assistants')
  .version(BUILD_VERSION)
  .addHelpText('after', `
Quick Start:
  $ promptcode expert "Why is this slow?" -f src/**/*.ts   # Ask AI about files
  $ promptcode generate -f src/**/*.ts                      # Generate prompt for AI
  $ promptcode preset create backend                        # Create reusable preset
  
Available Commands:
  $ promptcode generate -f "src/**/*.ts" -o prompt.md   # Generate prompt
  $ promptcode preset --create backend                   # Create preset
  $ promptcode expert "How to optimize this?" -p backend # Ask AI expert
  
Common Workflows:
  1. Explicit usage:
     $ promptcode expert "Why is this slow?" -f "src/**/*.ts"
     $ promptcode expert "Explain the auth flow" --preset auth
     $ promptcode generate -f "src/**/*.ts" -o prompt.md
  
  2. Expert consultation:
     $ export OPENAI_API_KEY=sk-...
     $ promptcode expert "Explain the auth flow" --preset auth
  
  3. Create and manage presets:
     $ promptcode preset create api-endpoints
     $ promptcode preset info api-endpoints

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
  $ promptcode generate -p api -o prompt.md  # Save to file
  $ promptcode generate -p api -i "Review for security issues"  # Inline instructions
  $ promptcode generate -p api --instructions-file review.md    # From file`)
  .option('-p, --preset <name>', 'use a preset (shorthand for -l)')
  .option('-f, --files <patterns...>', 'file glob patterns')
  .option('-l, --list <file>', 'file list or preset name (deprecated, use -p)')
  .option('-t, --template <name>', 'apply a template')
  .option('-i, --instructions <text|file>', 'instructions text or path to instructions file')
  .option('--instructions-file <file>', 'load instructions from file')
  .option('-o, --out <file>', 'output file (default: stdout)')
  .option('--output <file>', 'output file (alias for --out)')
  .option('--json', 'output JSON with metadata')
  .option('--ignore-gitignore', 'ignore .gitignore rules')
  .option('--path <dir>', 'project directory', process.cwd())
  .option('--save-preset <name>', 'save file patterns as a preset')
  .option('--dry-run', 'show what would be included without generating')
  .option('--token-warning <n>', 'token threshold for warning (default: 50000)')
  .option('--estimate-cost', 'estimate cost without generating')
  .option('--cost-threshold <usd>', 'maximum allowed cost before approval', process.env.PROMPTCODE_COST_THRESHOLD || '0.50')
  .option('--model <name>', 'model to use for cost estimation (default: gpt-5)')
  .option('-y, --yes', 'skip confirmation prompts')
  .allowExcessArguments(false)
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
  list                List all presets (default)
  create <name>       Create a new preset (auto-optimizes with --from-files)
  info <name>         Show preset details and token count
  optimize <name>     Optimize existing preset patterns (dry-run by default)
  search <query>      Search presets by name or content
  edit <name>         Edit preset in your editor
  delete <name>       Delete a preset

Examples:
  $ promptcode preset list
  $ promptcode preset create api --from-files "src/api/**/*.ts"
  $ promptcode preset info backend
  $ promptcode preset optimize backend           # Preview changes
  $ promptcode preset optimize backend --write   # Apply changes
  $ promptcode preset search "auth"
  $ promptcode generate -p backend

Options:
  --from-files <patterns...>     File patterns for create (auto-optimizes)
  --optimization-level <level>   Optimization level: minimal|balanced|aggressive (default: balanced)
  --write                        Apply optimization changes (for optimize command)
  --json                         Output in JSON format

Legacy flags (still supported):
  $ promptcode preset --create backend
  $ promptcode preset --info backend`)
  .option('--path <dir>', 'project root directory', process.cwd())
  .option('--list', 'list all presets (legacy)')
  .option('--create <name>', 'create a new preset (legacy)')
  .option('--info <name>', 'show preset info (legacy)')
  .option('--optimize <name>', 'optimize preset patterns (legacy)')
  .option('--edit <name>', 'edit preset (legacy)')
  .option('--delete <name>', 'delete a preset (legacy)')
  .option('--search <query>', 'search presets (legacy)')
  .option('--from-files <patterns...>', 'file patterns (space/comma separated)')
  .option('--optimization-level <level>', 'optimization level: minimal|balanced|aggressive', 'balanced')
  .option('--level <level>', 'alias for --optimization-level')
  .option('--write', 'apply optimization changes (for optimize command)')
  .option('--dry-run', 'preview changes without writing')
  .option('--json', 'output in JSON format (for list and info)')
  .action(async (action, name, options) => {
    // Handle direct subcommand syntax
    if (action && ['list', 'create', 'info', 'optimize', 'edit', 'delete', 'search'].includes(action)) {
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
  .description('Ask AI expert questions with optional codebase context')
  .addHelpText('after', `
Requires API key for chosen provider. Set via environment variables:
  $ export OPENAI_API_KEY=<key>     # For GPT-5, O3 models
  $ export ANTHROPIC_API_KEY=<key>  # For Opus 4, Sonnet 4  
  $ export GOOGLE_API_KEY=<key>     # For Gemini 2.5 Pro
  $ export GROK_API_KEY=<key>       # For Grok 4

Examples:
  $ promptcode expert "How can I optimize the API performance?"  # Pure AI consultation
  $ promptcode expert "Why is this slow?" -f "src/api/**/*.ts"  # With code context
  $ promptcode expert "Explain the authentication flow" --preset auth
  $ promptcode expert "Find potential security issues" -f "src/api/**/*.ts"
  $ promptcode expert "Review this code" --model opus-4 --stream
  $ promptcode expert --prompt-file analysis.md  # Use prompt from file
  $ promptcode expert --models  # See all available models
  $ promptcode expert "Analyze security" --preset api --json  # JSON output

Note: If both --preset and -f are specified, -f takes precedence (preset is ignored).`)
  .option('--path <dir>', 'project root directory', process.cwd())
  .option('--preset <name>', 'use a preset for context')
  .option('-f, --files <patterns...>', 'file patterns to include')
  .option('--prompt-file <file>', 'read prompt/question from a file')
  .option('--model <model>', 'AI model to use (use --models to see available options)')
  .option('--models', 'List available AI models')
  .option('-o, --output <file>', 'save response to file')
  .option('--stream', 'stream response in real-time')
  .option('--save-preset <name>', 'save file patterns as a preset')
  .option('-y, --yes', 'automatically confirm prompts')
  .option('--force', 'alias for --yes (skip cost confirmation)')
  .option('--no-confirm', 'skip all confirmations (same as --yes)')
  .option('--web-search', 'enable web search for current information (enabled by default for supported models)')
  .option('--no-web-search', 'disable web search even for supported models')
  .option('--verbosity <level>', 'response verbosity: low (concise), medium, high (detailed)', 'low')
  .option('--reasoning-effort <level>', 'reasoning depth: minimal, low, medium, high (default)', 'high')
  .option('--service-tier <tier>', 'service tier: auto, flex (50% cheaper), priority (enterprise)')
  .option('--json', 'output response in JSON format with usage stats')
  .option('--estimate-cost', 'estimate cost without running the query (dry-run)')
  .option('--cost-threshold <usd>', 'cost threshold for requiring approval (default: 0.50)', parseFloat)
  .allowExcessArguments(false)
  .action(async (question, options) => {
    await expertCommand(question, options);
  });

// Config command - manage configuration
program
  .command('config')
  .description('Show PromptCode configuration and environment variables')
  .option('--show', 'show current configuration (default action)')
  .option('--reset', 'reset all configuration')
  .action(async (options) => {
    await configCommand(options);
  });

// Models command - List available AI models
program
  .command('models')
  .description('List available AI models and their capabilities')
  .option('--json', 'output in JSON format')
  .option('--all', 'show all models including unavailable ones')
  .addHelpText('after', `
Examples:
  $ promptcode models                 # List available models
  $ promptcode models --all           # Show all models (including unavailable)
  $ promptcode models --json          # Output as JSON for scripting`)
  .action(async (options) => {
    await modelsCommand(options);
  });

// CC command - Claude integration setup
const ccCmd = program
  .command('cc [action] [subaction]')
  .description('Set up or manage Claude Code integration')
  .addHelpText('after', `
Actions:
  (none)           Install commands (asks about CLAUDE.md)
  install          Install commands (asks about CLAUDE.md)
  docs             Manage CLAUDE.md documentation
  uninstall        Remove Claude integration

Scope:
  --scope project  Install to project directory (default)
  --scope user     Install to user-wide directory (~/.claude/commands/)

Examples:
  $ promptcode cc                          # Install commands (project scope)
  $ promptcode cc --scope user             # Install commands (user-wide)
  $ promptcode cc install                  # Same as first example
  $ promptcode cc docs update              # Update CLAUDE.md only (project scope)
  $ promptcode cc docs diff                # Show CLAUDE.md changes
  $ promptcode cc docs check               # Check if CLAUDE.md needs update (CI)
  $ promptcode cc uninstall                # Remove commands (project scope)
  $ promptcode cc uninstall --scope user   # Remove user-wide commands
  $ promptcode cc uninstall --all          # Remove commands and CLAUDE.md (project scope)`)
  .option('--path <dir>', 'project root directory', process.cwd())
  .option('--scope <value>', 'installation scope: project (default) or user', 'project')
  .option('-s <value>', 'alias for --scope')
  .option('--with-docs', 'install CLAUDE.md (for backwards compatibility/CI)')
  .option('--force', 'update existing structure / skip confirmation prompts')
  .option('-y, --yes', 'alias for --force (CI-friendly)')
  .option('--dry-run', 'preview changes without applying')
  .option('--all', 'when uninstalling, remove both commands and docs')
  .option('--detect', 'detect Claude Code environment (exit 0 if found)', false)
  .action(async (action, subaction, options) => {
    // Handle subcommands
    if (action === 'docs') {
      // docs subcommand with subaction
      if (subaction === 'update') {
        await ccCommand({ ...options, docsOnly: true });
      } else if (subaction === 'diff') {
        await ccCommand({ ...options, docsOnly: true, diff: true });
      } else if (subaction === 'check') {
        await ccCommand({ ...options, docsOnly: true, check: true });
      } else {
        // Default to update
        await ccCommand({ ...options, docsOnly: true });
      }
    } else if (action === 'uninstall') {
      await ccCommand({ ...options, uninstall: true });
    } else if (action === 'install') {
      await ccCommand(options);
    } else if (!action) {
      // No action = default install (commands only)
      await ccCommand(options);
    } else {
      console.error(chalk.red(`Unknown action: ${action}`));
      console.error(chalk.gray('Run "promptcode cc --help" for usage'));
      process.exit(1);
    }
  });

// Cursor command - Cursor IDE/CLI integration setup
program
  .command('cursor')
  .description('Set up or remove Cursor AI integration (.cursor/rules folder)')
  .addHelpText('after', `
This command creates a .cursor/rules folder with:
  - MDC rule files: Instructions for Cursor AI agents
  - Pseudo-commands matching Claude Code: /promptcode-preset-list, /promptcode-preset-info, etc.
The .cursor folder is automatically detected in current or parent directories.

Scope:
  --scope project  Install to project directory (default)
  --scope user     Install to user-wide directory (~/.cursor/rules/)

Examples:
  $ promptcode cursor                          # Set up Cursor integration (project scope)
  $ promptcode cursor --scope user             # Set up user-wide integration
  $ promptcode cursor --uninstall              # Remove rules only (project scope)
  $ promptcode cursor --uninstall --scope user # Remove user-wide rules
  $ promptcode cursor --uninstall --all        # Remove rules and .cursorrules (project scope)
  $ promptcode cursor --yes                    # Skip confirmation prompts`)
  .option('--path <dir>', 'project directory', process.cwd())
  .option('--scope <value>', 'installation scope: project (default) or user', 'project')
  .option('-s <value>', 'alias for --scope')
  .option('--uninstall', 'remove Cursor integration', false)
  .option('--all', 'with --uninstall, also remove from .cursorrules', false)
  .option('--yes', 'skip confirmation prompts', false)
  .option('--force', 'force overwrite existing files', false)
  .option('--detect', 'detect Cursor environment (exit 0 if found)', false)
  .action(async (options) => {
    await cursorCommand(options);
  });

// Integrate command - Unified integration setup
program
  .command('integrate')
  .description('Automatically detect and set up AI environment integrations')
  .addHelpText('after', `
This command detects Claude Code and Cursor environments and offers to set them up.
Used automatically after install/update, or can be run manually.

Examples:
  $ promptcode integrate              # Detect and set up integrations
  $ promptcode integrate --auto-detect # Offer setup only if environments found
  $ promptcode integrate --skip-modified # Skip files with local changes`)
  .option('--path <dir>', 'project directory', process.cwd())
  .option('--auto-detect', 'automatically detect and offer integrations')
  .option('-y, --yes', 'skip confirmation prompts')
  .option('--skip-modified', 'skip files that have local modifications')
  .option('--force', 'force overwrite all files')
  .action(async (options) => {
    await integrateCommand(options);
  });

// Stats command (quick stats about current directory)
program
  .command('stats')
  .description('Show token statistics for current project or preset')
  .option('--path <dir>', 'project root directory', process.cwd())
  .option('-p, --preset <name>', 'analyze a specific preset')
  .option('--json', 'output in JSON format')
  .addHelpText('after', '\nShows file count, total tokens, and breakdown by file type.')
  .action(async (options) => {
    const { initializeTokenCounter } = await import('@promptcode/core');
    const path = await import('path');
    const { runStats } = await import('./utils/stats-scanner');
    const { exitInTestMode } = await import('./utils/environment');
    
    // Initialize token counter for caching
    const cacheDir = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '', '.cache', 'promptcode');
    initializeTokenCounter(cacheDir, '0.1.0');
    
    const projectPath = path.resolve(options.path);
    
    // Create abort controller for graceful cancellation
    const abortController = new AbortController();
    const handleInterrupt = () => {
      abortController.abort();
      // Don't exit immediately - let the stats runner handle it gracefully
    };
    
    process.on('SIGINT', handleInterrupt);
    process.on('SIGTERM', handleInterrupt);
    
    try {
      await runStats(projectPath, {
        preset: options.preset,
        json: options.json,
        signal: abortController.signal
      });
      
      // Force exit in test mode
      exitInTestMode(0);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    } finally {
      process.removeListener('SIGINT', handleInterrupt);
      process.removeListener('SIGTERM', handleInterrupt);
    }
  });

// Removed commands: diff, watch, validate, extract
// These were rarely used and added unnecessary complexity.
// Core functionality is focused on: generate, expert, preset, cc

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

// Self-update command
program.addCommand(updateCommand);

// Uninstall command
program.addCommand(uninstallCommand);

// Help command - explicitly handle help as a command
program
  .command('help [command]')
  .description('display help for command')
  .action((cmd) => {
    if (cmd) {
      // Show help for specific command
      const command = program.commands.find(c => c.name() === cmd || c.aliases().includes(cmd));
      if (command) {
        command.outputHelp();
      } else {
        console.error(chalk.red(`Error: Unknown command '${cmd}'`));
        console.error(chalk.gray('\nFor available commands: promptcode --help'));
        process.exit(1);
      }
    } else {
      // Show general help
      program.outputHelp();
    }
    process.exit(0);
  });

// Custom version display with --detailed option
program
  .option('--detailed', 'Show detailed version and build information')
  .hook('preAction', (thisCommand) => {
    // Check if --detailed flag is present without any command
    const opts = thisCommand.opts();
    if (opts.detailed && process.argv.length === 3) {
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
      process.exit(0);
    }
  });

// Parse command line arguments
// Normalize argv across runtimes/OS (some environments may pass empty args)
const rawArgs = process.argv.slice(2);
let args = rawArgs.filter(arg => arg !== null && arg !== undefined && arg.trim() !== '');

// If no meaningful args, show help and exit successfully
if (args.length === 0) {
  program.outputHelp();
  process.exit(0);
}

// Handle --command syntax by converting to command syntax BEFORE any parsing
// This allows commands to work with -- prefix (e.g., --cc becomes cc)
if (args[0] && args[0].startsWith('--')) {
  const possibleCommand = args[0].substring(2);
  const knownCommandNames = [
    'generate', 'cache', 'templates', 'list-templates', 'preset',
    'expert', 'config', 'models', 'cc', 'stats', 'history', 'update', 'uninstall', 'help'
  ];
  
  if (knownCommandNames.includes(possibleCommand)) {
    // Convert --command to command
    args[0] = possibleCommand;
    // Update process.argv so Commander.js sees the corrected version
    process.argv[2] = possibleCommand;
  }
}

const knownCommands = [
  'generate', 'cache', 'templates', 'list-templates', 'preset', 
  'expert', 'config', 'models', 'cc', 'cursor', 'integrate', 'stats', 'history', 'update', 'uninstall', 'help',
  '--help', '-h', '--version', '-V', '--detailed'
];

// Check if first arg looks like a command (alphanumeric, not a path)
const firstArg = args[0];
const looksLikeCommand = firstArg && /^[a-z][a-z0-9]*$/i.test(firstArg) && !firstArg.includes('/') && !firstArg.includes('.');

// Check for removed commands and provide helpful migration messages
const REMOVED_COMMANDS = new Set(['diff', 'watch', 'validate', 'extract']);
if (looksLikeCommand && REMOVED_COMMANDS.has(firstArg)) {
  console.error(chalk.red(`The '${firstArg}' command was removed in v0.3.x to simplify the CLI.`));
  console.error(chalk.yellow('\nSuggested alternatives:'));
  
  if (firstArg === 'diff') {
    console.error(chalk.gray('  • Use your VCS (git diff) to preview/apply changes'));
    console.error(chalk.gray('  • Use your editor\'s diff tools'));
  } else if (firstArg === 'extract') {
    console.error(chalk.gray('  • Ask your AI tool to save code blocks directly to files'));
    console.error(chalk.gray('  • Use your editor\'s code block extraction features'));
  } else if (firstArg === 'validate') {
    console.error(chalk.gray('  • Use your project\'s linter (eslint, prettier, etc.)'));
    console.error(chalk.gray('  • Run your test suite to validate code'));
  } else if (firstArg === 'watch') {
    console.error(chalk.gray('  • Use your editor\'s file watcher'));
    console.error(chalk.gray('  • Use native tools like fswatch or inotify'));
  }
  
  process.exit(2);
}

// If it looks like a command but isn't known, show error
if (looksLikeCommand && !knownCommands.includes(firstArg)) {
  console.error(chalk.red(`Error: Unknown command '${firstArg}'`));
  console.error(chalk.yellow('\nDid you mean one of these?'));
  
  // Suggest similar commands
  if (firstArg === 'init') {
    console.error(chalk.gray('  cc        # Set up .promptcode folder and Claude integration'));
  }
  
  console.error(chalk.gray('\nFor available commands: promptcode --help'));
  process.exit(1);
}

// Check for common mistakes
if (args.includes('--update')) {
  console.error(chalk.yellow('Did you mean: promptcode update'));
  console.error(chalk.gray('The update command doesn\'t use dashes.'));
  process.exit(1);
}

// After converting --command to command, check if we have a known subcommand
const hasSubcommand = args.length > 0 && knownCommands.includes(args[0]);

if (!hasSubcommand && args.length > 0) {
  // Invalid command found, show error
  showHelpOrError(args);
} else if (hasSubcommand) {
  // Start async update check - will show message at exit if update available
  startUpdateCheck();
  
  // Parse the normalized args as user-supplied (no implicit node/script entries)
  program.parse(args, { from: 'user' });
}