import ora from 'ora';
import { shouldShowSpinner } from './environment';

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
  
  return ora();
}