/**
 * Polyfills for Bun standalone binary compatibility
 *
 * When compiled to a standalone binary with Bun, process.stderr/stdout
 * might not be immediately available. This ensures they exist before
 * any code tries to access them.
 */

// Ensure process exists
if (typeof process === 'undefined') {
  (global as any).process = {};
}

// Create safe stream stubs if needed
const createSafeStream = (name: 'stdout' | 'stderr') => {
  const stream = (process as any)[name];

  // If stream doesn't exist or is incomplete, create a safe stub
  if (!stream || typeof stream !== 'object') {
    const safeStream = {
      write: (data: any) => {
        // Try to write to console as fallback
        if (name === 'stderr') {
          console.error(String(data));
        } else {
          console.log(String(data));
        }
        return true;
      },
      isTTY: false, // Safe default for non-interactive
      columns: 80,
      rows: 24,
      fd: name === 'stdout' ? 1 : 2,
      // Add minimal stream methods
      on: () => safeStream,
      once: () => safeStream,
      emit: () => false,
      removeListener: () => safeStream,
    };

    Object.defineProperty(process, name, {
      get: () => safeStream,
      configurable: true
    });
  } else if (stream.isTTY === undefined) {
    // Stream exists but isTTY might be undefined
    stream.isTTY = false;
  }
};

// Initialize both streams
createSafeStream('stdout');
createSafeStream('stderr');

// Also ensure stdin exists
if (!process.stdin || typeof process.stdin !== 'object') {
  const safeStdin = {
    isTTY: false,
    setRawMode: () => safeStdin,
    resume: () => safeStdin,
    pause: () => safeStdin,
    on: () => safeStdin,
    once: () => safeStdin,
    emit: () => false,
    removeListener: () => safeStdin,
  };

  Object.defineProperty(process, 'stdin', {
    get: () => safeStdin,
    configurable: true
  });
} else if (process.stdin.isTTY === undefined) {
  process.stdin.isTTY = false;
}

// Export empty object to make this a module
export {};