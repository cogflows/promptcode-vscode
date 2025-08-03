#!/usr/bin/env node

/**
 * Resolves the version string for builds
 * - Production builds: Uses package.json version as-is
 * - Development builds: Appends -dev.YYYYMMDD.gitHash
 * 
 * Usage: node scripts/resolveVersion.ts [path-to-package.json]
 */

const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

// Get package.json path from argument or use the one in the current directory
const packagePath = process.argv[2] || './package.json';
const packageJson = JSON.parse(readFileSync(resolve(packagePath), 'utf8'));
const baseVersion = packageJson.version;

// Get git information
let gitHash = 'unknown';
let gitBranch = 'unknown';
let isGitClean = true;

try {
  // Get short commit hash
  gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  
  // Get current branch name
  gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  
  // Check if working directory is clean
  const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  isGitClean = gitStatus === '';
} catch (e) {
  // Git commands failed, probably not in a git repo
  console.error('Warning: Git information unavailable', e.message);
}

// Get current date in YYYYMMDD format
const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

// Determine if this is a production build
const isCI = !!process.env.CI;
const isTagBuild = !!process.env.GIT_TAG;
const forceProd = process.env.PROD_BUILD === '1';
const forceVersion = process.env.FORCE_VERSION; // Allow explicit version override

// Generate version string
let version;

if (forceVersion) {
  // Explicit version override (useful for testing)
  version = forceVersion;
} else if (forceProd || (isCI && isTagBuild)) {
  // Production build: use base version
  version = baseVersion;
} else {
  // Development build: append dev identifier
  version = `${baseVersion}-dev.${date}.${gitHash}`;
}

// Output version (just the version string, nothing else)
process.stdout.write(version);

// If running in verbose mode, output additional information to stderr
if (process.env.VERBOSE === '1') {
  console.error('\n--- Version Resolution Info ---');
  console.error(`Base version: ${baseVersion}`);
  console.error(`Git hash: ${gitHash}`);
  console.error(`Git branch: ${gitBranch}`);
  console.error(`Git clean: ${isGitClean}`);
  console.error(`Date: ${date}`);
  console.error(`CI: ${isCI}`);
  console.error(`Tag build: ${isTagBuild}`);
  console.error(`Force prod: ${forceProd}`);
  console.error(`Final version: ${version}`);
  console.error('-------------------------------\n');
}