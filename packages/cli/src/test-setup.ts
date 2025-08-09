// Test setup file for Bun tests
// This file is loaded before all tests

// Declare global type for storing original console.warn
declare global {
  var __originalConsoleWarn: typeof console.warn | undefined;
}

// Suppress console.warn during tests unless explicitly testing warnings
const originalWarn = console.warn;
globalThis.__originalConsoleWarn = originalWarn;

// Mock console.warn by default
console.warn = () => {};

// Export function to restore console.warn for specific tests
export function restoreConsoleWarn() {
  if (globalThis.__originalConsoleWarn) {
    console.warn = globalThis.__originalConsoleWarn;
  }
}

export function mockConsoleWarn() {
  console.warn = () => {};
}