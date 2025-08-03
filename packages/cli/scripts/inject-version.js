#!/usr/bin/env node

/**
 * Injects version into the source code before building
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get version from resolveVersion script
const version = execSync('node ../../scripts/resolveVersion.js ./package.json', { encoding: 'utf8' }).trim();

// Create version.ts file
const versionContent = `// Auto-generated file - DO NOT EDIT
// Generated at build time by scripts/inject-version.js

export const BUILD_VERSION = '${version}';
export const BUILD_TIME = '${new Date().toISOString()}';
`;

// Write to src/version.ts
fs.writeFileSync(path.join(__dirname, '../src/version.ts'), versionContent);

console.log(`Injected version: ${version}`);