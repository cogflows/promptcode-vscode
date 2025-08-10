import ora from 'ora';
import { shouldShowSpinner } from './environment';

// Track active spinners for cleanup
const activeSpinners = new Set<any>();

// Cleanup function to stop all spinners and restore cursor
function cleanupSpinners() {
  for (const spinner of activeSpinners) {
    if (spinner.isSpinning) {
      spinner.stop();
    }
  }
  // Only restore cursor if we had active spinners (and thus might have hidden it)
  if (activeSpinners.size > 0 && shouldShowSpinner()) {
    process.stdout.write('\x1B[?25h');
  }
}

// Ensure all spinners are stopped on exit
process.on('exit', cleanupSpinners);

// Handle uncaught errors
process.on('uncaughtException', () => {
  cleanupSpinners();
});

// Handle signals properly - avoid infinite recursion
const signalHandler = (sig: NodeJS.Signals) => {
  // Remove this handler to avoid recursion when we re-emit
  process.removeListener(sig, signalHandler as any);
  cleanupSpinners();
  // Re-emit signal to preserve default behavior
  process.kill(process.pid, sig);
};

['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'].forEach(sig => {
  process.on(sig as NodeJS.Signals, signalHandler);
});

/**
 * Create a spinner that respects environment settings
 */
export function spinner() {
  if (!shouldShowSpinner()) {
    // Return a no-op spinner for non-interactive environments
    const noOpSpinner = {
      start: function(text?: string) { 
        this.text = text || '';
        this.isSpinning = true;
        return this; // Return same instance for chaining
      },
      succeed: function(text?: string) { 
        console.log(text || '✓');
        this.isSpinning = false;
        return this;
      },
      fail: function(text?: string) { 
        console.error(text || '✗');
        this.isSpinning = false;
        return this;
      },
      warn: function(text?: string) { 
        console.warn(text || '⚠');
        this.isSpinning = false;
        return this;
      },
      info: function(text?: string) { 
        console.log(text || 'ℹ');
        this.isSpinning = false;
        return this;
      },
      stop: function() {
        this.isSpinning = false;
        return this;
      },
      text: '',
      isSpinning: false
    };
    return noOpSpinner;
  }
  
  const spinner = ora();
  
  // Don't track until started to avoid memory leaks
  let isTracked = false;
  
  // Wrap methods to ensure cleanup
  const originalStart = spinner.start.bind(spinner);
  const originalStop = spinner.stop.bind(spinner);
  const originalSucceed = spinner.succeed.bind(spinner);
  const originalFail = spinner.fail.bind(spinner);
  
  spinner.start = (text?: string) => {
    const result = originalStart(text);
    if (!isTracked) {
      activeSpinners.add(spinner);
      isTracked = true;
    }
    return spinner; // Always return same instance
  };
  
  spinner.stop = () => {
    const result = originalStop();
    if (isTracked) {
      activeSpinners.delete(spinner);
      isTracked = false;
    }
    return result;
  };
  
  spinner.succeed = (text?: string) => {
    const result = originalSucceed(text);
    if (isTracked) {
      activeSpinners.delete(spinner);
      isTracked = false;
    }
    return result;
  };
  
  spinner.fail = (text?: string) => {
    const result = originalFail(text);
    if (isTracked) {
      activeSpinners.delete(spinner);
      isTracked = false;
    }
    return result;
  };
  
  return spinner;
}