/**
 * Environment and runtime detection utilities
 */

/**
 * Check if running in test environment
 */
export function isTestEnvironment(): boolean {
  return process.env.PROMPTCODE_TEST === '1' ||
         process.env.NODE_ENV === 'test';
}

/**
 * Check if running in CI environment
 */
export function isCIEnvironment(): boolean {
  return process.env.CI === 'true' ||
         process.env.GITHUB_ACTIONS === 'true' ||
         process.env.GITLAB_CI === 'true' ||
         process.env.CIRCLECI === 'true';
}

/**
 * Check if running in Bun runtime
 */
export function isBunRuntime(): boolean {
  return typeof process.versions?.bun === 'string';
}

/**
 * Check if running Bun on macOS (has TTY/kqueue issues)
 */
export function isBunOnMacOS(): boolean {
  return isBunRuntime() && process.platform === 'darwin';
}

/**
 * Check if the current environment supports interactive prompts
 */
export function isInteractive(): boolean {
  // Force non-interactive in test/CI environments
  if (isTestEnvironment() || isCIEnvironment()) {
    return false;
  }

  // Use POSIX FD checks for accurate TTY detection
  const fs = require('fs');
  const isTerm = (fd: 0 | 1): boolean => {
    try {
      return fs.fstatSync(fd).isCharacterDevice();
    } catch {
      return false;
    }
  };

  return isTerm(1) && isTerm(0);
}

/**
 * Check if interactive prompts can be used (considering runtime limitations)
 */
export function canUseInteractivePrompts(): boolean {
  return isInteractive();
}

/**
 * Check if spinner should be shown
 */
export function shouldShowSpinner(options?: { json?: boolean }): boolean {
  return Boolean(
    !options?.json &&
    process.stdout?.isTTY &&
    !isTestEnvironment()
  );
}

/**
 * Get token warning threshold
 */
export function getTokenThreshold(options?: { tokenWarning?: number }): number {
  return options?.tokenWarning || 
         parseInt(process.env.PROMPTCODE_TOKEN_WARNING || '50000');
}

/**
 * Check if confirmations should be skipped
 */
export function shouldSkipConfirmation(options?: { 
  yes?: boolean; 
  force?: boolean; 
  noConfirm?: boolean;
}): boolean {
  return !!(options?.yes || 
            options?.force || 
            options?.noConfirm);
}

/**
 * Force exit in test mode to prevent hanging
 */
export function exitInTestMode(code: number = 0): void {
  if (isTestEnvironment()) {
    process.exit(code);
  }
}