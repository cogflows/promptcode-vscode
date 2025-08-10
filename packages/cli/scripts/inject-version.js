#!/usr/bin/env node

/**
 * Injects version into the source code before building
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get version from resolveVersion script
// Try monorepo path first, fall back to reading package.json directly
let version;
try {
  version = execSync('node ../../../scripts/resolveVersion.js ../package.json', { encoding: 'utf8' }).trim();
} catch (error) {
  // Fallback: read version directly from package.json
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  
  // For production builds, use clean version without dev suffix
  if (process.env.PROD_BUILD === '1') {
    version = packageJson.version;
  } else {
    const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    version = `${packageJson.version}-dev.${date}.${gitHash}`;
  }
  
  if (!process.env.PROD_BUILD) {
    console.warn('Warning: resolveVersion.js not found, using fallback version generation');
  }
}

// Create version.ts file
const versionContent = `// Auto-generated file - DO NOT EDIT
// Generated at build time by scripts/inject-version.js

export const BUILD_VERSION: string = '${version}';
export const BUILD_TIME: string = '${new Date().toISOString()}';
`;

// Write to src/version.ts
fs.writeFileSync(path.join(__dirname, '../src/version.ts'), versionContent);

console.log(`Injected version: ${version}`);