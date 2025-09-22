/**
 * Minimal polyfills for Bun compatibility
 *
 * Bun v1.2.22+ provides process.stdout/stderr/stdin, but doesn't set isTTY properly.
 * This minimal polyfill only addresses the TTY detection issue.
 */

// Only apply polyfills if running in Bun
if (typeof process.versions?.bun === 'string') {
  // Bun doesn't properly set isTTY, which breaks inquirer and other TTY-dependent libraries
  // Use POSIX FD checks to accurately detect TTY without triggering kqueue issues

  // Use POSIX FD checks; avoids constructing Node TTY streams in Bun
  const isCharDevice = (fd: 0 | 1 | 2): boolean => {
    try {
      const fs = require('fs');
      return fs.fstatSync(fd).isCharacterDevice();
    } catch {
      return false;
    }
  };

  const stdoutTTY = isCharDevice(1);
  const stderrTTY = isCharDevice(2);
  const stdinTTY = isCharDevice(0);

  if (process.stdout && process.stdout.isTTY === undefined) {
    process.stdout.isTTY = stdoutTTY;
  }

  if (process.stderr && process.stderr.isTTY === undefined) {
    process.stderr.isTTY = stderrTTY;
  }

  if (process.stdin && process.stdin.isTTY === undefined) {
    process.stdin.isTTY = stdinTTY;
  }
}

// Export empty object to make this a module
export {};