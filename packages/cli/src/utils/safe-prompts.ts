/**
 * Safe wrapper for interactive prompts with Bun compatibility
 *
 * Handles the macOS kqueue TTY issue with Bun by gracefully
 * falling back to non-interactive mode when needed.
 */

import chalk from 'chalk';
import { isInteractive, isBunOnMacOS, isBunRuntime } from './environment';
import { bunTextPrompt, bunConfirmPrompt, bunSelectPrompt, shouldUseBunPrompts } from './bun-prompts';

// Lazy-load inquirer to avoid crashes and reduce startup cost
let _inquirer: typeof import('inquirer').default | null = null;
const getInquirer = async (): Promise<typeof import('inquirer').default> => {
  if (!_inquirer) {
    _inquirer = (await import('inquirer')).default;
  }
  return _inquirer;
};

/**
 * Safe wrapper for inquirer.prompt that handles Bun/macOS TTY issues
 */
export async function safePrompt<T = any>(
  questions: any,
  defaultAnswers?: Partial<T>
): Promise<T> {
  // If non-interactive, return defaults immediately
  if (!isInteractive()) {
    if (!defaultAnswers) {
      throw new Error('Cannot run prompts in non-interactive mode without defaults');
    }
    if (process.env.PROMPTCODE_DEBUG_PROMPTS === '1') {
      console.log(chalk.gray('[prompts] non-interactive → defaults'));
    }
    return defaultAnswers as T;
  }

  // Try Bun native prompts for simple cases (1-3 questions, basic types)
  if (shouldUseBunPrompts() && Array.isArray(questions) && questions.length >= 1 && questions.length <= 3) {
    if (process.env.PROMPTCODE_DEBUG_PROMPTS === '1') {
      console.log(chalk.gray('[prompts] using bun-native'));
    }
    try {
      const answers: Record<string, any> = {};
      for (const q of questions) {
        if (q.type === 'confirm') {
          answers[q.name] = await bunConfirmPrompt(q.message, q.default ?? true);
        } else if (q.type === 'input' || !q.type) {
          answers[q.name] = await bunTextPrompt(q.message, q.default);
        } else if (q.type === 'list' && q.choices) {
          const choices = q.choices.map((c: any) => ({
            name: typeof c === 'string' ? c : c.name || c.value,
            value: typeof c === 'string' ? c : c.value
          }));
          answers[q.name] = await bunSelectPrompt(q.message, choices, 0, q.default);
        } else {
          throw new Error('Unsupported question type for Bun prompt');
        }
      }
      return answers as unknown as T;
    } catch (error) {
      // Fall through to inquirer
      console.log(chalk.yellow('⚠️  Bun prompt failed, trying inquirer...'));
    }
  }

  try {
    if (process.env.PROMPTCODE_DEBUG_PROMPTS === '1') {
      console.log(chalk.gray('[prompts] using inquirer'));
    }
    const inquirer = await getInquirer();
    return await inquirer.prompt(questions) as T;
  } catch (error: any) {
    // Check for kqueue/TTY error specifically
    if (
      error?.message?.includes('EINVAL') ||
      error?.message?.includes('kqueue') ||
      error?.message?.includes('WriteStream') ||
      error?.code === 'EINVAL'
    ) {
      // Known Bun/macOS issue - provide helpful message
      if (isBunOnMacOS()) {
        console.log(
          chalk.yellow('\n⚠️  Interactive prompts unavailable (Bun on macOS).')
        );
        console.log(
          chalk.gray('   Using defaults. Run with --yes to skip prompts.\n')
        );
      }

      // Return defaults if available
      if (defaultAnswers) {
        return defaultAnswers as T;
      }

      // No defaults available, re-throw with better message
      throw new Error(
        'Interactive prompts failed. Please run with --yes flag or in a Node.js environment.'
      );
    }

    // Unknown error, re-throw
    throw error;
  }
}

/**
 * Safe confirm prompt with default value
 */
export async function safeConfirm(
  message: string,
  defaultValue: boolean = true
): Promise<boolean> {
  if (!isInteractive()) {
    return defaultValue;
  }

  // Try Bun native prompts first if available
  if (shouldUseBunPrompts()) {
    try {
      return await bunConfirmPrompt(message, defaultValue);
    } catch (error) {
      // Fall through to inquirer
      console.log(chalk.yellow('⚠️  Bun prompt failed, trying inquirer...'));
    }
  }

  try {
    const inquirer = await getInquirer();
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message,
        default: defaultValue,
      },
    ]);
    return proceed;
  } catch (error: any) {
    // Handle kqueue error
    if (
      error?.message?.includes('EINVAL') ||
      error?.message?.includes('kqueue') ||
      error?.code === 'EINVAL'
    ) {
      if (isBunOnMacOS()) {
        console.log(chalk.yellow('⚠️  Using default:'), defaultValue ? 'yes' : 'no');
      }
      return defaultValue;
    }
    throw error;
  }
}

/**
 * Export getInquirer for cases where direct inquirer access is needed
 */
export { getInquirer };