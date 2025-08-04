import chalk from 'chalk';
import * as path from 'path';
import { readHistory, getHistoryEntry, historyToPreset } from '../services/history';

interface HistoryOptions {
  show?: string;
  preset?: string;
  name?: string;
  limit?: number;
  json?: boolean;
}

/**
 * Format a timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffMins < 1440) {
    return `${Math.floor(diffMins / 60)}h ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Format patterns for display
 */
function formatPatterns(patterns: string[]): string {
  if (patterns.length === 1) {
    return patterns[0];
  } else if (patterns.length <= 3) {
    return patterns.join(', ');
  } else {
    return `${patterns.slice(0, 2).join(', ')} +${patterns.length - 2} more`;
  }
}

export async function historyCommand(options: HistoryOptions): Promise<void> {
  const projectPath = process.cwd();
  
  // Handle --preset option to convert entry to preset
  if (options.preset !== undefined && options.name) {
    const index = parseInt(options.preset, 10);
    if (isNaN(index)) {
      console.error(chalk.red('Error: Entry index must be a number'));
      process.exit(1);
    }
    
    try {
      await historyToPreset(index, options.name, projectPath);
      console.log(chalk.green(`✓ Created preset '${options.name}' from history entry ${index}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
    return;
  }
  
  // Handle --show option to display full entry
  if (options.show !== undefined) {
    const index = parseInt(options.show, 10);
    if (isNaN(index)) {
      console.error(chalk.red('Error: Entry index must be a number'));
      process.exit(1);
    }
    
    const entry = await getHistoryEntry(index);
    if (!entry) {
      console.error(chalk.red(`Error: History entry ${index} not found`));
      process.exit(1);
    }
    
    if (options.json) {
      console.log(JSON.stringify(entry, null, 2));
    } else {
      console.log(chalk.bold(`\nHistory Entry #${index}`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Timestamp: ${chalk.cyan(entry.timestamp)}`);
      console.log(`Command: ${chalk.cyan(entry.command)}`);
      if (entry.question) {
        console.log(`Question: ${chalk.cyan(entry.question)}`);
      }
      console.log(`Project: ${chalk.cyan(entry.projectName)} (${entry.projectPath})`);
      if (entry.gitCommit) {
        console.log(`Git commit: ${chalk.cyan(entry.gitCommit)}`);
      }
      console.log(`Files: ${chalk.cyan(entry.fileCount || 'N/A')} (${entry.tokenCount?.toLocaleString() || 'N/A'} tokens)`);
      if (entry.model) {
        console.log(`Model: ${chalk.cyan(entry.model)}`);
      }
      console.log(chalk.bold('\nPatterns:'));
      entry.patterns.forEach(p => console.log(`  ${p}`));
    }
    return;
  }
  
  // Default: list recent entries
  const limit = options.limit || 10;
  const entries = await readHistory(limit);
  
  if (entries.length === 0) {
    console.log(chalk.gray('No history entries found'));
    return;
  }
  
  if (options.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  
  console.log(chalk.bold('\nRecent PromptCode History'));
  console.log(chalk.gray('─'.repeat(80)));
  
  entries.forEach((entry, index) => {
    const time = formatTimestamp(entry.timestamp);
    const patterns = formatPatterns(entry.patterns);
    const cmd = entry.command === 'expert' ? chalk.blue('expert') : chalk.green('generate');
    
    console.log(
      chalk.gray(`[${index.toString().padStart(2)}]`) + ' ' +
      chalk.gray(time.padEnd(10)) + ' ' +
      cmd.padEnd(10) + ' ' +
      chalk.cyan(entry.projectName.padEnd(20).slice(0, 20)) + ' ' +
      patterns
    );
    
    if (entry.question) {
      console.log(`     ${chalk.gray('Q:')} ${entry.question.slice(0, 60)}${entry.question.length > 60 ? '...' : ''}`);
    }
  });
  
  console.log(chalk.gray('\nUse "promptcode history --show <index>" to see full details'));
  console.log(chalk.gray('Use "promptcode history --preset <index> <name>" to save as preset'));
}