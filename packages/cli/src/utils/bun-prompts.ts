/**
 * Bun-native prompt implementations
 *
 * Uses Bun's built-in console iterator for stdin reading,
 * avoiding the macOS kqueue/TTY issues with inquirer.
 */

import chalk from 'chalk';
import { isBunRuntime } from './environment';

/**
 * Simple text prompt using Bun's native console iterator
 */
export async function bunTextPrompt(message: string, defaultValue?: string): Promise<string> {
  if (!isBunRuntime()) {
    throw new Error('bunTextPrompt can only be used in Bun runtime');
  }

  // Display the prompt
  process.stdout.write(chalk.cyan('? ') + message);
  if (defaultValue) {
    process.stdout.write(chalk.gray(` (${defaultValue})`));
  }
  process.stdout.write(': ');

  // Read input using Bun's console iterator
  const iterator = console[Symbol.asyncIterator]();
  const { value } = await iterator.next();

  // Clean up the iterator
  await iterator.return?.();

  const input = value?.toString().trim();
  return input || defaultValue || '';
}

/**
 * Yes/No confirm prompt using Bun's native console
 */
export async function bunConfirmPrompt(message: string, defaultValue: boolean = true): Promise<boolean> {
  if (!isBunRuntime()) {
    throw new Error('bunConfirmPrompt can only be used in Bun runtime');
  }

  const defaultHint = defaultValue ? 'Y/n' : 'y/N';
  process.stdout.write(chalk.cyan('? ') + message + ` (${defaultHint}) `);

  // Read input
  const iterator = console[Symbol.asyncIterator]();
  const { value } = await iterator.next();
  await iterator.return?.();

  const input = value?.toString().trim().toLowerCase();

  if (!input) {
    return defaultValue;
  }

  return input === 'y' || input === 'yes';
}

/**
 * Select prompt using Bun's native console
 */
export async function bunSelectPrompt<T = string>(
  message: string,
  choices: Array<{ name: string; value: T }>,
  defaultIndex: number = 0,
  defaultValue?: T
): Promise<T> {
  if (!isBunRuntime()) {
    throw new Error('bunSelectPrompt can only be used in Bun runtime');
  }

  // Resolve default index by value if provided
  if (defaultValue !== undefined) {
    const idx = choices.findIndex(c => Object.is(c.value, defaultValue));
    if (idx >= 0) defaultIndex = idx;
  }

  // Display the prompt and choices
  console.log(chalk.cyan('? ') + message);
  choices.forEach((choice, index) => {
    const prefix = index === defaultIndex ? chalk.green('❯') : ' ';
    console.log(`  ${prefix} ${choice.name}`);
  });

  // Simple implementation: ask for number
  process.stdout.write(chalk.gray(`\nEnter choice [1-${choices.length}] (default: ${defaultIndex + 1}): `));

  const iterator = console[Symbol.asyncIterator]();
  const { value } = await iterator.next();
  await iterator.return?.();

  const input = value?.toString().trim();

  if (!input) {
    return choices[defaultIndex].value;
  }

  const choiceNum = parseInt(input, 10);
  if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > choices.length) {
    console.log(chalk.yellow('Invalid choice, using default'));
    return choices[defaultIndex].value;
  }

  return choices[choiceNum - 1].value;
}

/**
 * Check if Bun native prompts should be used
 */
export function shouldUseBunPrompts(): boolean {
  // Use Bun prompts only when *definitely* in a TTY
  return isBunRuntime() && process.stdout?.isTTY === true && process.stdin?.isTTY === true;
}