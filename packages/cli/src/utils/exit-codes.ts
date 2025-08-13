/**
 * Standardized exit codes for the CLI
 * These enable programmatic handling of CLI results
 */

export const EXIT_CODES = {
  SUCCESS: 0,                    // Operation completed successfully
  GENERAL_ERROR: 1,              // General error
  APPROVAL_REQUIRED: 2,          // Cost approval needed (non-interactive mode)
  INVALID_INPUT: 3,              // Invalid command or arguments
  MISSING_API_KEY: 4,           // API key not configured
  CONTEXT_TOO_LARGE: 5,         // Context exceeds model limits
  FILE_NOT_FOUND: 6,            // File or preset not found
  OPERATION_CANCELLED: 7,       // User cancelled operation
  NETWORK_ERROR: 8,             // Network or API error
  PERMISSION_DENIED: 9,         // Permission denied for file operations
} as const;

export type ExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES];

/**
 * Exit the process with a standardized code and optional message
 */
export function exitWithCode(code: ExitCode, message?: string): never {
  if (message) {
    console.error(message);
  }
  process.exit(code);
}