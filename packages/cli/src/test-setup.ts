// Test setup file for Bun tests
// This file is loaded before all tests

// Suppress console.warn during tests unless explicitly testing warnings
const originalWarn = console.warn;
globalThis.__originalConsoleWarn = originalWarn;

// Mock console.warn by default
console.warn = () => {};

// Export function to restore console.warn for specific tests
export function restoreConsoleWarn() {
  console.warn = globalThis.__originalConsoleWarn;
}

export function mockConsoleWarn() {
  console.warn = () => {};
}