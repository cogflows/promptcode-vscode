import ora from 'ora';
import { shouldShowSpinner } from './environment';

// Track active spinners for cleanup
const activeSpinners = new Set<any>();

// Ensure all spinners are stopped on exit
process.on('exit', () => {
  for (const spinner of activeSpinners) {
    if (spinner.isSpinning) {
      spinner.stop();
    }
  }
});

// Handle uncaught errors
process.on('uncaughtException', () => {
  for (const spinner of activeSpinners) {
    if (spinner.isSpinning) {
      spinner.stop();
    }
  }
});

/**
 * Create a spinner that respects environment settings
 */
export function spinner() {
  if (!shouldShowSpinner()) {
    // Return a no-op spinner for non-interactive environments
    return {
      start: (text?: string) => ({ 
        text, 
        succeed: (text?: string) => console.log(text || '✓'),
        fail: (text?: string) => console.error(text || '✗'),
        warn: (text?: string) => console.warn(text || '⚠'),
        info: (text?: string) => console.log(text || 'ℹ'),
        stop: () => {},
        isSpinning: false
      }),
      succeed: (text?: string) => console.log(text || '✓'),
      fail: (text?: string) => console.error(text || '✗'),
      warn: (text?: string) => console.warn(text || '⚠'),
      info: (text?: string) => console.log(text || 'ℹ'),
      stop: () => {},
      text: ''
    };
  }
  
  const spinner = ora();
  
  // Track this spinner
  activeSpinners.add(spinner);
  
  // Wrap methods to ensure cleanup
  const originalStop = spinner.stop.bind(spinner);
  const originalSucceed = spinner.succeed.bind(spinner);
  const originalFail = spinner.fail.bind(spinner);
  
  spinner.stop = () => {
    const result = originalStop();
    activeSpinners.delete(spinner);
    return result;
  };
  
  spinner.succeed = (text?: string) => {
    const result = originalSucceed(text);
    activeSpinners.delete(spinner);
    return result;
  };
  
  spinner.fail = (text?: string) => {
    const result = originalFail(text);
    activeSpinners.delete(spinner);
    return result;
  };
  
  return spinner;
}