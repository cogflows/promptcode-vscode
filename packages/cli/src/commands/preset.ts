import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { scanFiles, initializeTokenCounter, listFilesByPatternsFile, optimizeSelection, type OptimizationLevel, type OptimizationResult } from '@promptcode/core';
import { findPromptcodeFolder, ensureDirWithApproval, getProjectRoot, getPresetDir, getPresetPath, getCacheDir, resolveProjectPath } from '../utils/paths';
import { spinner } from '../utils/spinner';
import { CACHE_VERSION } from '../utils/constants';
import { separatePatternsFromPaths, validatePatternSafety, directoryToPattern } from '../utils/pattern-utils';

interface PresetOptions {
  path?: string;
  list?: boolean;
  create?: string;
  info?: string;
  delete?: string;
  edit?: string;
  search?: string;
  json?: boolean;
  fromFiles?: string[];              // file globs (create only)
  optimizationLevel?: OptimizationLevel; // preferred flag name
  level?: OptimizationLevel;             // legacy alias
  // optimize subcommand (existing presets only)
  optimize?: string;                 // preset name to optimize
  dryRun?: boolean;                  // preview only (default true for optimize)
  write?: boolean;                   // apply changes
}


/**
 * Ensure presets directory exists with user approval
 */
async function ensurePresetsDir(presetsDir: string): Promise<boolean> {
  return await ensureDirWithApproval(presetsDir, '.promptcode/presets');
}

/**
 * List all presets
 */
async function listPresets(projectPath: string, options: { json?: boolean } = {}): Promise<void> {
  const presetsDir = getPresetDir(projectPath);
  try {
    const files = await fs.promises.readdir(presetsDir);
    const presets = files.filter(f => f.endsWith('.patterns'));
    
    if (options.json) {
      // JSON output for programmatic use
      const presetData = [];
      for (const preset of presets) {
        const presetName = preset.replace('.patterns', '');
        const presetPath = path.join(presetsDir, preset);
        const content = await fs.promises.readFile(presetPath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        presetData.push({
          name: presetName,
          path: presetPath,
          patternCount: lines.length,
          patterns: lines
        });
      }
      console.log(JSON.stringify({ 
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        presets: presetData 
      }, null, 2));
      return;
    }
    
    if (presets.length === 0) {
      console.log(chalk.yellow('No presets found. Create one with: promptcode preset --create <name>'));
      return;
    }
    
    console.log(chalk.bold('Available presets:'));
    console.log(chalk.gray('─'.repeat(50)));
    
    for (const preset of presets) {
      const presetName = preset.replace('.patterns', '');
      const presetPath = path.join(presetsDir, preset);
      const content = await fs.promises.readFile(presetPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      
      console.log(`  ${chalk.cyan(presetName.padEnd(20))} ${chalk.gray(`${lines.length} patterns`)}`);
    }
    
    console.log(chalk.gray('\nUse: promptcode generate -p <preset-name>'));
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      if (options.json) {
        console.log(JSON.stringify({ 
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        presets: [], 
        error: 'No presets directory found' 
      }, null, 2));
      } else {
        console.log(chalk.yellow('No presets directory found. Create one with: promptcode preset --create <name>'));
      }
    } else {
      throw error;
    }
  }
}

/**
 * Show preset info with token count
 */
async function showPresetInfo(presetName: string, projectPath: string, options: { json?: boolean } = {}): Promise<void> {
  const spin = options.json ? { start: () => {}, stop: () => {}, fail: () => {} } : spinner();
  
  if (!options.json) {
    spin.start('Analyzing preset...');
  }
  
  try {
    // Initialize token counter
    const cacheDir = getCacheDir();
    initializeTokenCounter(cacheDir, CACHE_VERSION);
    
    const presetPath = getPresetPath(projectPath, presetName);
    
    if (!fs.existsSync(presetPath)) {
      if (options.json) {
        console.log(JSON.stringify({ error: `Preset not found: ${presetName}` }, null, 2));
      } else {
        spin.fail(`Preset not found: ${presetName}`);
        spin.stop(); // Ensure cleanup
      }
      return;
    }
    
    const content = await fs.promises.readFile(presetPath, 'utf8');
    const patterns = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    
    // projectPath is already the project root thanks to resolveProjectPath
    const projectRoot = projectPath;
    const files = await scanFiles({
      cwd: projectRoot,
      patterns,
      respectGitignore: true,
      workspaceName: path.basename(projectRoot)
    });
    
    spin.stop();
    
    const totalTokens = files.reduce((sum, f) => sum + f.tokenCount, 0);
    
    if (options.json) {
      // JSON output for programmatic use
      const result = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        name: presetName,
        path: presetPath,
        patterns: patterns,
        patternCount: patterns.length,
        fileCount: files.length,
        totalTokens: totalTokens,
        files: files.map(f => ({
          path: f.path, // Already relative to project root from scanFiles
          tokenCount: f.tokenCount
        })).sort((a, b) => b.tokenCount - a.tokenCount)
      };
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    
    console.log(chalk.bold(`Preset: ${chalk.cyan(presetName)}`));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Path: ${presetPath}`);
    console.log(`Patterns: ${patterns.length}`);
    console.log(`Files matched: ${chalk.cyan(files.length)}`);
    console.log(`Total tokens: ${chalk.cyan(totalTokens.toLocaleString())}`);
    
    if (files.length > 0) {
      console.log(chalk.bold('\nTop files by tokens:'));
      const topFiles = files
        .sort((a, b) => b.tokenCount - a.tokenCount)
        .slice(0, 10);
      
      for (const file of topFiles) {
        // file.path is already relative to the project root from scanFiles
        const relativePath = file.path;
        console.log(`  ${relativePath.padEnd(50)} ${chalk.gray(file.tokenCount.toLocaleString() + ' tokens')}`);
      }
    }
    
    console.log(chalk.bold('\nPatterns:'));
    patterns.forEach(p => console.log(`  ${p}`));
    
    console.log(chalk.bold('\nUsage Examples:'));
    console.log(chalk.gray('  # Generate prompt with this preset:'));
    console.log(`  ${chalk.cyan(`promptcode generate --preset ${presetName}`)}`);
    console.log(`  ${chalk.cyan(`promptcode generate -p ${presetName} -o output.md`)}`);
    
    console.log(chalk.gray('\n  # Ask AI expert with this preset:'));
    console.log(`  ${chalk.cyan(`promptcode expert "Explain the architecture" --preset ${presetName}`)}`);
    console.log(`  ${chalk.cyan(`promptcode expert "What are the security risks?" --preset ${presetName}`)}`);
    
    console.log(chalk.gray('\n  # Save output to file:'));
    console.log(`  ${chalk.cyan(`promptcode generate --preset ${presetName} --output /tmp/${presetName}-${new Date().toISOString().split('T')[0]}.txt`)}`);
    
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: (error as Error).message }, null, 2));
    } else {
      spin.fail(chalk.red(`Error: ${(error as Error).message}`));
      spin.stop(); // Ensure cleanup
    }
  }
}

/**
 * Render header + patterns with metadata
 */
function renderPresetFile(
  name: string,
  patterns: string[],
  meta?: {
    level?: OptimizationLevel;
    applied?: { rule: string; details: string; beforeCount: number; afterCount: number }[];
    stats?: { inputFiles: number; finalPatterns: number; savedPatterns: number };
    source?: string;
    patternsPreserved?: number;
    directoriesConverted?: number;
    optimized?: any;
  }
): string {
  const lines: string[] = [];
  lines.push(`# ${name} preset`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  if (meta?.source) {lines.push(`# Source: ${meta.source}`);}
  
  // Add specific metadata about what was done
  if (meta?.patternsPreserved) {
    lines.push(`# Patterns preserved as provided: ${meta.patternsPreserved}`);
  }
  if (meta?.directoriesConverted) {
    lines.push(`# Directories converted to patterns: ${meta.directoriesConverted}`);
  }
  
  if (meta?.optimized) {
    lines.push(`# Optimization: ${meta.optimized.level}`);
    if (meta.optimized.stats) {
      lines.push(
        `# Optimized: ${meta.optimized.stats.inputFiles} files → ${meta.optimized.stats.finalPatterns} patterns (saved ${meta.optimized.stats.savedPatterns})`
      );
    }
    if (meta.optimized.applied?.length) {
      lines.push('# Applied rules:');
      for (const a of meta.optimized.applied) {
        lines.push(`#   - ${a.rule}: ${a.details}`);
      }
    }
  }
  
  lines.push('');
  // Patterns (include first, excludes later already sorted by optimizer)
  for (const p of patterns) {lines.push(p);}
  // Common excludes at the end if not already present
  const mustEnd = ['!**/node_modules/**', '!**/dist/**', '!**/build/**'];
  for (const m of mustEnd) {
    if (!patterns.includes(m)) {lines.push(m);}
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Convert --from-files args into a normalized array of globs
 */
function normalizeFromFiles(fromFiles?: string[] | string): string[] {
  if (!fromFiles) {return [];}
  const raw = Array.isArray(fromFiles) ? fromFiles : [fromFiles];
  return raw
    .flatMap((chunk) =>
      chunk
        .split(/\r?\n|,/g)
        .map((s) => s.trim())
        .filter(Boolean)
    );
}

/**
 * Create a new preset (optionally from files + optimization)
 */
async function createPreset(presetName: string, projectPath: string, opts?: {
  fromFiles?: string[];
  optimizationLevel?: OptimizationLevel;
  level?: OptimizationLevel; // alias
}): Promise<void> {
  const presetsDir = getPresetDir(projectPath);
  const dirCreated = await ensurePresetsDir(presetsDir);
  
  if (!dirCreated) {
    console.log(chalk.red('Cannot create preset without presets directory'));
    return;
  }
  
  const presetPath = getPresetPath(projectPath, presetName);
  
  if (fs.existsSync(presetPath)) {
    console.log(chalk.red(`Preset already exists: ${presetName}`));
    console.log(chalk.gray('Use --edit to modify it'));
    return;
  }

  const from = normalizeFromFiles(opts?.fromFiles);

  // If no files provided, create the legacy default (no auto-optimization)
  if (!from.length) {
    const defaultContent = `# ${presetName} preset
# Use gitignore syntax for patterns
# Include patterns:
**/*.ts
**/*.tsx
**/*.js
**/*.jsx

# Exclude patterns (use ! prefix):
!**/node_modules/**
!**/*.test.*
!**/*.spec.*
!**/dist/**
!**/build/**
`;
    await fs.promises.writeFile(presetPath, defaultContent);
    console.log(chalk.green(`✓ Created preset: ${presetName}`));
    console.log(chalk.gray(`  Path: ${presetPath}`));
    console.log(chalk.gray(`  Edit the file to customize patterns`));
    console.log(chalk.gray(`  Use: promptcode generate -p ${presetName}`));
    return;
  }

  // NEW: Intelligently handle patterns vs paths
  const projectRoot = projectPath;
  const { patterns, directories, files, mixed } = separatePatternsFromPaths(from, projectRoot);
  
  // Validate all patterns for safety
  validatePatternSafety([...patterns, ...directories, ...files]);
  
  let finalPatterns: string[] = [];
  const metadata: any = { source: '' };
  
  // 1. Preserve glob patterns as-is
  if (patterns.length > 0) {
    finalPatterns.push(...patterns);
    metadata.patternsPreserved = patterns.length;
  }
  
  // 2. Convert directories to patterns
  if (directories.length > 0) {
    for (const dir of directories) {
      finalPatterns.push(directoryToPattern(dir));
    }
    metadata.directoriesConverted = directories.length;
  }
  
  // 3. Optimize concrete file paths
  if (files.length > 0) {
    // First, make file paths absolute from project root for scanning
    const absoluteFiles = files.map(f => {
      if (path.isAbsolute(f)) {
        return f;
      }
      return path.resolve(projectRoot, f);
    });
    
    const scannedFiles = await scanFiles({
      cwd: projectRoot,
      patterns: absoluteFiles,
      respectGitignore: true,
      workspaceName: path.basename(projectRoot)
    });
    
    if (scannedFiles.length > 0) {
      const selection = scannedFiles.map((f) => {
        // Ensure we get relative paths from the project root
        const absolutePath = path.isAbsolute(f.path) ? f.path : path.resolve(projectRoot, f.path);
        return path.relative(projectRoot, absolutePath);
      });
      const level: OptimizationLevel = opts?.optimizationLevel || opts?.level || 'balanced';
      const result = await optimizeSelection(selection, projectRoot, level);
      
      finalPatterns.push(...result.patterns);
      metadata.optimized = {
        level,
        applied: result.applied,
        stats: result.stats
      };
    }
  }
  
  // Set appropriate source description
  if (mixed) {
    const parts = [];
    if (patterns.length > 0) {parts.push(`${patterns.length} patterns preserved`);}
    if (directories.length > 0) {parts.push(`${directories.length} directories`);}
    if (files.length > 0 && metadata.optimized) {
      parts.push(`${files.length} files → ${metadata.optimized.stats.finalPatterns} patterns`);
    }
    metadata.source = `mixed (${parts.join(', ')})`;
  } else if (patterns.length > 0) {
    metadata.source = `patterns preserved (${patterns.length})`;
  } else if (directories.length > 0) {
    metadata.source = `directories converted (${directories.length})`;
  } else if (metadata.optimized) {
    metadata.source = `files optimized (${files.length} → ${metadata.optimized.stats.finalPatterns} patterns)`;
  }

  // Deduplicate patterns while preserving order (keep first occurrence)
  const deduplicatedPatterns = Array.from(new Set(finalPatterns));
  
  const content = renderPresetFile(presetName, deduplicatedPatterns, metadata);
  await fs.promises.writeFile(presetPath, content);
  
  // Clear user feedback
  console.log(chalk.green(`✓ Created preset: ${presetName}`));
  console.log(chalk.gray(`  Path: ${presetPath}`));
  
  if (patterns.length > 0) {
    console.log(chalk.cyan(`  📁 Patterns preserved: ${patterns.length}`));
  }
  if (directories.length > 0) {
    console.log(chalk.cyan(`  📂 Directories converted: ${directories.length}`));
  }
  if (files.length > 0 && metadata.optimized) {
    console.log(chalk.cyan(`  ⚡ Files optimized: ${files.length} → ${metadata.optimized.stats.finalPatterns} patterns`));
    console.log(chalk.gray(`  Optimization level: ${metadata.optimized.level}`));
  }
  
  console.log(chalk.gray(`  Use: promptcode generate -p ${presetName}`));
}

/**
 * Delete a preset
 */
async function deletePreset(presetName: string, projectPath: string): Promise<void> {
  const presetPath = getPresetPath(projectPath, presetName);
  
  if (!fs.existsSync(presetPath)) {
    console.log(chalk.red(`Preset not found: ${presetName}`));
    return;
  }
  
  await fs.promises.unlink(presetPath);
  console.log(chalk.green(`✓ Deleted preset: ${presetName}`));
}

/**
 * Optimize an existing preset (dry-run by default)
 */
async function optimizePresetOrFiles(projectPath: string, args: {
  presetName?: string;      // optimize this preset
  level?: OptimizationLevel;
  dryRun?: boolean;
  json?: boolean;
  write?: boolean;
}): Promise<void> {
  const spin = args.json ? { start: () => {}, stop: () => {}, succeed: () => {}, fail: () => {}, text: '' } : spinner();
  if (!args.json) {
    spin.start('Analyzing preset patterns...');
  }

  const level = args.level || 'balanced';
  const shouldWrite = !!args.write && !args.dryRun;

  try {
    let selection: string[] = [];
    let origin = '';

    if (args.presetName) {
      const presetPath = getPresetPath(projectPath, args.presetName);
      if (!fs.existsSync(presetPath)) {
        if (args.json) {
          console.log(JSON.stringify({ error: `Preset not found: ${args.presetName}` }, null, 2));
        } else {
          spin.fail(chalk.red(`Preset not found: ${args.presetName}`));
        }
        return;
      }
      // Expand preset -> concrete file list
      // projectPath is already the project root thanks to resolveProjectPath
      const projectRoot = projectPath;
      const files = await listFilesByPatternsFile(presetPath, projectRoot);
      selection = files;
      origin = `preset:${args.presetName}`;
    } else {
      if (args.json) {
        console.log(JSON.stringify({ error: 'Nothing to optimize. Provide a preset name.' }, null, 2));
      } else {
        spin.fail('Nothing to optimize. Provide a preset name.');
      }
      return;
    }

    // projectPath is already the project root thanks to resolveProjectPath
    const projectRoot = projectPath;
    const result = await optimizeSelection(selection, projectRoot, level);

    // If preset: prepare diff
    let diffText = '';
    if (args.presetName) {
      const presetPath = getPresetPath(projectPath, args.presetName);
      const before = await fs.promises.readFile(presetPath, 'utf8');
      const after = renderPresetFile(args.presetName!, result.patterns, {
        level,
        applied: result.applied,
        stats: result.stats,
        source: origin,
      });
      const { createTwoFilesPatch } = await import('diff');
      diffText = createTwoFilesPatch(
        `${args.presetName}.patterns (before)`,
        `${args.presetName}.patterns (after)`,
        before,
        after,
        'current',
        'proposed'
      );
      if (args.json) {
        console.log(JSON.stringify({
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          level,
          origin,
          inputFiles: selection.length,
          patterns: result.patterns,
          applied: result.applied,
          stats: result.stats,
          dryRun: !shouldWrite,
          diff: diffText,
        }, null, 2));
        return;
      }
      spin.stop();
      // Default: show diff (dry-run)
      console.log(diffText);
      console.log(chalk.gray(`\nLevel: ${level}; Files: ${selection.length}; Patterns: ${result.patterns.length}; Saved: ${result.stats.savedPatterns}`));
      if (!shouldWrite) {
        console.log(chalk.yellow('\nDry-run complete. Re-run with --write to apply these changes.'));
        return;
      }
      // Apply
      await fs.promises.writeFile(presetPath, after);
      console.log(chalk.green(`\n✓ Optimized preset written: ${args.presetName}`));
      return;
    }

    // Fallback message
    spin.stop();
    console.log(chalk.yellow('Nothing to write.'));

  } catch (err) {
    if (args.json) {
      console.log(JSON.stringify({ error: (err as Error).message }, null, 2));
    } else {
      spin.fail(chalk.red(`Error: ${(err as Error).message}`));
    }
  }
}

/**
 * Search presets by query string
 */
async function searchPresets(query: string, projectPath: string): Promise<void> {
  const presetsDir = getPresetDir(projectPath);
  
  try {
    const files = await fs.promises.readdir(presetsDir);
    const presets = files.filter(f => f.endsWith('.patterns'));
    
    if (presets.length === 0) {
      console.log(chalk.yellow('No presets found to search'));
      return;
    }
    
    const queryLower = query.toLowerCase();
    const results: Array<{ name: string; score: number; matches: string[] }> = [];
    
    for (const preset of presets) {
      const presetName = preset.replace('.patterns', '');
      const presetPath = path.join(presetsDir, preset);
      const content = await fs.promises.readFile(presetPath, 'utf8');
      const lines = content.split('\n');
      
      let score = 0;
      const matches: string[] = [];
      
      // Check preset name
      if (presetName.toLowerCase().includes(queryLower)) {
        score += 10;
        matches.push(`Name: ${presetName}`);
      }
      
      // Check content lines
      lines.forEach((line, index) => {
        const lineLower = line.toLowerCase();
        if (lineLower.includes(queryLower)) {
          if (line.startsWith('#')) {
            // Comments are more valuable
            score += 3;
            matches.push(`Comment (line ${index + 1}): ${line.trim()}`);
          } else if (line.trim()) {
            score += 1;
            matches.push(`Pattern (line ${index + 1}): ${line.trim()}`);
          }
        }
      });
      
      if (score > 0) {
        results.push({ name: presetName, score, matches });
      }
    }
    
    if (results.length === 0) {
      console.log(chalk.yellow(`No presets found matching: "${query}"`));
      return;
    }
    
    // Sort by score
    results.sort((a, b) => b.score - a.score);
    
    console.log(chalk.bold(`Search results for: "${query}"`));
    console.log(chalk.gray('─'.repeat(50)));
    
    for (const result of results) {
      console.log(`\n${chalk.cyan(result.name)} ${chalk.gray(`(score: ${result.score})`)}`);
      // Show first 3 matches
      result.matches.slice(0, 3).forEach(match => {
        console.log(chalk.gray(`  ${match}`));
      });
      if (result.matches.length > 3) {
        console.log(chalk.gray(`  ... and ${result.matches.length - 3} more matches`));
      }
    }
    
    console.log(chalk.gray('\nUse: promptcode preset info <name> to see full details'));
    
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      console.log(chalk.yellow('No presets directory found'));
    } else {
      throw error;
    }
  }
}

/**
 * Edit a preset (open in editor)
 */
async function editPreset(presetName: string, projectPath: string): Promise<void> {
  const presetPath = getPresetPath(projectPath, presetName);
  
  if (!fs.existsSync(presetPath)) {
    console.log(chalk.red(`Preset not found: ${presetName}`));
    console.log(chalk.gray('Use --create to create it'));
    return;
  }
  
  // Check if we're in an interactive terminal
  const isInteractive = process.stdout?.isTTY && process.stdin?.isTTY;
  
  if (!isInteractive) {
    console.log(chalk.yellow('Non-interactive environment detected.'));
    console.log(chalk.bold(`\nPreset location:`));
    console.log(chalk.cyan(presetPath));
    console.log(chalk.gray('\nEdit this file manually to update patterns.'));
    
    // Show current content
    console.log(chalk.bold('\nCurrent patterns:'));
    const content = await fs.promises.readFile(presetPath, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (i < 20) { // Show first 20 lines
        console.log(chalk.gray(`  ${line}`));
      }
    });
    if (lines.length > 20) {
      console.log(chalk.gray(`  ... and ${lines.length - 20} more lines`));
    }
    return;
  }
  
  // Try to open in default editor
  const defaultEditor = process.platform === 'win32' ? 'notepad' : 'nano';
  const editor = process.env.EDITOR || defaultEditor;
  const { spawn } = await import('child_process');
  
  console.log(chalk.gray(`Opening ${presetPath} in ${editor}...`));
  const child = spawn(editor, [presetPath], { stdio: 'inherit' });
  
  child.on('exit', (code) => {
    if (code === 0) {
      console.log(chalk.green('✓ Preset edited successfully'));
    }
  });
}

/**
 * Preset command implementation
 */
export async function presetCommand(options: PresetOptions): Promise<void> {
  // This now intelligently finds the project root
  const projectPath = resolveProjectPath(options.path);
  const presetsDir = getPresetDir(projectPath);
  
  try {
    // Optimize existing preset (dry-run by default; --write applies)
    if (options.optimize) {
      await optimizePresetOrFiles(projectPath, {
        presetName: options.optimize,
        level: options.optimizationLevel || options.level || 'balanced',
        dryRun: options.dryRun ?? !options.write, // default dry-run
        write: options.write,
        json: options.json,
      });
      return;
    }

    if (options.list || (!options.create && !options.info && !options.delete && !options.edit && !options.search)) {
      await listPresets(projectPath, { json: options.json });
    } else if (options.create) {
      await createPreset(options.create, projectPath, {
        fromFiles: normalizeFromFiles(options.fromFiles),
        optimizationLevel: options.optimizationLevel || options.level || 'balanced'
      });
    } else if (options.info) {
      await showPresetInfo(options.info, projectPath, { json: options.json });
    } else if (options.delete) {
      await deletePreset(options.delete, projectPath);
    } else if (options.edit) {
      await editPreset(options.edit, projectPath);
    } else if (options.search) {
      await searchPresets(options.search, projectPath);
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: (error as Error).message }, null, 2));
    } else {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    }
    // Don't exit in test mode - let the error propagate
    if (process.env.PROMPTCODE_TEST !== '1' && process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw error; // Re-throw for tests to catch
  }
}
