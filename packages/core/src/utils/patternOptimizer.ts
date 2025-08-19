import * as path from 'path';
import * as fs from 'fs';
import { minimatch } from 'minimatch';
import fg from 'fast-glob';

/** Optimization levels */
export type OptimizationLevel = 'minimal' | 'balanced' | 'aggressive';

export interface OptimizationRuleApplication {
  rule:
    | 'full-directory'
    | 'almost-all-exclusion'
    | 'dir-extension'
    | 'global-extension'
    | 'brace-merge-dirs'
    | 'brace-merge-extensions';
  details: string;
  beforeCount: number;
  afterCount: number;
}

export interface OptimizationResult {
  level: OptimizationLevel;
  patterns: string[];
  applied: OptimizationRuleApplication[];
  stats: {
    inputFiles: number;
    finalPatterns: number;
    savedPatterns: number;
  };
}

// Default patterns for ignoring files and directories
const DEFAULT_IGNORES = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'out/**',
  '.vscode/**',
  '**/*.log',
  '**/.DS_Store',
];

const toPosix = (p: string) => p.replace(/\\/g, '/');

const depth = (p: string) => (p ? p.split('/').length : 0);

/**
 * Get all files recursively in a directory (using fast-glob for performance)
 */
async function getAllFilesInDir(dir: string, workspaceRoot: string): Promise<string[]> {
  const cwd = path.resolve(workspaceRoot, dir);
  
  try {
    // Check if directory exists and is not a symlink
    const stat = await fs.promises.lstat(cwd);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return [];
    }
  } catch {
    return [];
  }
  
  const files = await fg(['**/*'], {
    cwd,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: DEFAULT_IGNORES,
  });
  
  // Return paths relative to workspaceRoot/dir
  return files.map(f => path.join(dir, f).replace(/\\/g, '/')).sort();
}

function dirsFromSelection(paths: string[]): string[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    let d = path.posix.dirname(p);
    while (d && d !== '.') {
      dirs.add(d);
      d = path.posix.dirname(d);
    }
  }
  return Array.from(dirs);
}

function filesInDir(all: string[], dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : dir + '/';
  return all.filter((f) => {
    if (f === dir) return false;
    if (f.startsWith(prefix)) return true;
    if (dir === path.posix.dirname(f)) return true;
    return false;
  });
}

function hasNestedSubdirs(all: string[], dir: string): boolean {
  const prefix = dir.endsWith('/') ? dir : dir + '/';
  return all.some((f) => f.startsWith(prefix) && f.slice(prefix.length).includes('/'));
}

function extOf(file: string): string {
  const base = path.posix.basename(file);
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.slice(idx + 1) : '';
}

/**
 * Merge sibling dir patterns into brace form.
 * Example: src/api/** + src/auth/** becomes src/{api,auth}/**
 */
function mergeWithBraces(patterns: string[]): { patterns: string[]; changes: OptimizationRuleApplication[] } {
  const includes = patterns.filter((p) => !p.startsWith('!'));
  const excludes = patterns.filter((p) => p.startsWith('!'));

  const groups = new Map<string, string[]>(); // parent -> [child...]
  for (const p of includes) {
    if (!p.endsWith('/**')) continue;
    const base = p.slice(0, -3); // remove '/**'
    const parent = path.posix.dirname(base);
    if (!parent || parent === '.') continue;
    const child = path.posix.basename(base);
    const key = parent;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(child);
  }

  let changed = false;
  const toRemove = new Set<string>();
  const toAdd: string[] = [];
  const changes: OptimizationRuleApplication[] = [];

  for (const [parent, children] of groups.entries()) {
    if (children.length < 2) continue;
    const originals = children.map((c) => `${parent}/${c}/**`);
    const brace = `${parent}/{${children.sort().join(',')}}/**`;
    originals.forEach((o) => toRemove.add(o));
    toAdd.push(brace);
    changes.push({
      rule: 'brace-merge-dirs',
      details: `${parent}/{${
        children.sort().join(',')
      }}/** (merged ${children.length} sibling directories)`,
      beforeCount: children.length,
      afterCount: 1,
    });
    changed = true;
  }

  if (!changed) return { patterns, changes: [] };

  const next = includes.filter((p) => !toRemove.has(p)).concat(toAdd);
  // Keep excludes untouched, at the end
  return { patterns: next.concat(excludes), changes };
}

/**
 * Merge extension siblings into brace form for the same prefix.
 * Example: multiple .ts and .tsx files become .{ts,tsx}
 */
function mergeExtensionBraces(patterns: string[]): {
  patterns: string[];
  changes: OptimizationRuleApplication[];
} {
  const includes = patterns.filter((p) => !p.startsWith('!'));
  const excludes = patterns.filter((p) => p.startsWith('!'));
  const map = new Map<string, Set<string>>(); // prefix-with-*dot -> {exts}

  const candidate = (p: string) => {
    const m = p.match(/^(.*\*\.)(([a-zA-Z0-9]+))$/); // e.g., "src/**/foo/*." + "ts"
    if (!m) return null;
    return { prefix: m[1], ext: m[2] };
  };

  for (const p of includes) {
    if (p.includes('{') || p.includes('}')) continue; // already braced
    const c = candidate(p);
    if (!c) continue;
    if (!map.has(c.prefix)) map.set(c.prefix, new Set());
    map.get(c.prefix)!.add(c.ext);
  }

  const toRemove = new Set<string>();
  const toAdd: string[] = [];
  const changes: OptimizationRuleApplication[] = [];

  for (const [prefix, exts] of map.entries()) {
    if (exts.size < 2) continue;
    const sorted = [...exts].sort();
    const brace = `${prefix}{${sorted.join(',')}}`;
    // Remove each individual pattern and add the braced one
    for (const e of sorted) toRemove.add(`${prefix}${e}`);
    toAdd.push(brace);
    changes.push({
      rule: 'brace-merge-extensions',
      details: `${brace} (merged ${sorted.length} extensions)`,
      beforeCount: sorted.length,
      afterCount: 1,
    });
  }

  if (!toRemove.size) return { patterns, changes: [] };

  const next = includes.filter((p) => !toRemove.has(p)).concat(toAdd).concat(excludes);
  return { patterns: next, changes };
}

/**
 * Main optimizer
 */
export async function optimizeSelection(
  selectedPaths: string[],
  workspaceRoot: string,
  level: OptimizationLevel = 'balanced',
): Promise<OptimizationResult> {
  if (!selectedPaths.length) {
    return {
      level,
      patterns: [],
      applied: [],
      stats: { inputFiles: 0, finalPatterns: 0, savedPatterns: 0 },
    };
  }

  // Security: reject absolute/traversal selections
  const bad = selectedPaths.find(p => path.isAbsolute(p) || p.includes('..'));
  if (bad) {
    throw new Error(`Unsafe selection path: "${bad}". Selection must be relative to workspace root.`);
  }

  const posixSelected = selectedPaths.map(toPosix).sort();
  const selectedSet = new Set(posixSelected);
  
  // Get all files in workspace for comparison (async)
  const workspaceFiles = await getAllFilesInDir('.', workspaceRoot);
  
  // Filter files using proper glob matching
  const allFiles: string[] = workspaceFiles.filter(f => {
    return !DEFAULT_IGNORES.some(pattern => minimatch(f, pattern));
  });
  
  const covered = new Set<string>();
  let patterns: string[] = [];
  const applied: OptimizationRuleApplication[] = [];

  // 1) Full-directory coverage (deepest-first)
  const dirCandidates = dirsFromSelection(posixSelected).sort((a, b) => depth(b) - depth(a));
  for (const dir of dirCandidates) {
    const files = filesInDir(allFiles, dir);
    if (files.length === 0) continue;
    const allSelected = files.every((f) => selectedSet.has(f));
    if (allSelected) {
      patterns.push(`${dir}/**`);
      files.forEach((f) => covered.add(f));
      applied.push({
        rule: 'full-directory',
        details: dir,
        beforeCount: files.length,
        afterCount: 1,
      });
    }
  }

  // 2) Almost-all within a directory (Balanced: 1 missing; Aggressive: up to 2)
  if (level === 'balanced' || level === 'aggressive') {
    const missingThreshold = level === 'balanced' ? 1 : 2;

    for (const dir of dirCandidates) {
      const files = filesInDir(allFiles, dir);
      if (files.length === 0) continue;

      const unCoveredSelected = files.filter((f) => selectedSet.has(f) && !covered.has(f));
      if (!unCoveredSelected.length) continue;

      const missing = files.filter((f) => !selectedSet.has(f));
      const already = patterns.some((p) => p === `${dir}/**`);
      if (already) continue;

      if (missing.length > 0 && missing.length <= missingThreshold) {
        patterns.push(`${dir}/**`);
        for (const m of missing) patterns.push('!' + m);
        unCoveredSelected.forEach((f) => covered.add(f));
        applied.push({
          rule: 'almost-all-exclusion',
          details: `${dir} (exclude ${missing.length})`,
          beforeCount: unCoveredSelected.length,
          afterCount: 1 + missing.length,
        });
      }
    }
  }

  // 3) Extension grouping
  const notCovered = posixSelected.filter((f) => !covered.has(f));

  // 3a) Dir-level extension grouping (Balanced & Aggressive)
  if (level !== 'minimal') {
    // Build (dir -> ext -> files)
    const dirToExtSel = new Map<string, Map<string, string[]>>();
    for (const f of notCovered) {
      const d = path.posix.dirname(f);
      const e = extOf(f);
      if (!e) continue;
      if (!dirToExtSel.has(d)) dirToExtSel.set(d, new Map());
      const m = dirToExtSel.get(d)!;
      if (!m.has(e)) m.set(e, []);
      m.get(e)!.push(f);
    }
    for (const [dir, byExt] of dirToExtSel.entries()) {
      for (const [e, sel] of byExt.entries()) {
        const all = filesInDir(allFiles, dir).filter((f) => extOf(f) === e);
        if (all.length && all.length === sel.length) {
          const glob = hasNestedSubdirs(allFiles, dir) ? `${dir}/**/*.${e}` : `${dir}/*.${e}`;
          patterns.push(glob);
          sel.forEach((f) => covered.add(f));
          applied.push({
            rule: 'dir-extension',
            details: `${dir} *.${e}`,
            beforeCount: sel.length,
            afterCount: 1,
          });
        }
      }
    }
  }

  // 3b) Global extension grouping (Aggressive)
  if (level === 'aggressive') {
    const extToFiles = new Map<string, string[]>();
    for (const f of posixSelected.filter((x) => !covered.has(x))) {
      const e = extOf(f);
      if (!e) continue;
      if (!extToFiles.has(e)) extToFiles.set(e, []);
      extToFiles.get(e)!.push(f);
    }
    for (const [e, sel] of extToFiles.entries()) {
      const all = allFiles.filter((f) => extOf(f) === e);
      const remaining = sel.filter((s) => !covered.has(s));
      if (all.length && remaining.length === all.length) {
        patterns.push(`**/*.${e}`);
        remaining.forEach((f) => covered.add(f));
        applied.push({
          rule: 'global-extension',
          details: `**/*.${e}`,
          beforeCount: remaining.length,
          afterCount: 1,
        });
      }
    }
  }

  // 4) Remaining files as-is
  for (const f of posixSelected) {
    if (!covered.has(f)) patterns.push(f);
  }

  // Deduplicate while preserving order
  patterns = patterns.filter((p, i, a) => a.indexOf(p) === i);

  // 5) Aggressive brace merges
  if (level === 'aggressive') {
    const dirMerge = mergeWithBraces(patterns);
    patterns = dirMerge.patterns;
    applied.push(...dirMerge.changes);

    const extMerge = mergeExtensionBraces(patterns);
    patterns = extMerge.patterns;
    applied.push(...extMerge.changes);
  }

  // Organize: directories → extension globs → files → excludes
  const includes = patterns.filter((p) => !p.startsWith('!'));
  const excludes = patterns.filter((p) => p.startsWith('!'));

  const dirIncl = includes.filter((p) => p.endsWith('/**'));
  const extIncl = includes.filter((p) => p.includes('*.') && !p.endsWith('/**'));
  const fileIncl = includes.filter((p) => !dirIncl.includes(p) && !extIncl.includes(p));

  const sorted = [...dirIncl.sort(), ...extIncl.sort(), ...fileIncl.sort(), ...excludes.sort()];

  return {
    level,
    patterns: sorted,
    applied,
    stats: {
      inputFiles: posixSelected.length,
      finalPatterns: sorted.length,
      savedPatterns: Math.max(0, posixSelected.length - sorted.length),
    },
  };
}