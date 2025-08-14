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
 * Check if the current environment supports interactive prompts
 */
export function isInteractive(): boolean {
  return process.stdout.isTTY && 
         process.stdin.isTTY && 
         !isTestEnvironment() &&
         !isCIEnvironment();
}

/**
 * Check if spinner should be shown
 */
export function shouldShowSpinner(options?: { json?: boolean }): boolean {
  return !options?.json && 
         process.stdout.isTTY && 
         !isTestEnvironment();
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