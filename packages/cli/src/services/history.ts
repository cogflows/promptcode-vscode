import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { findPromptcodeFolder, ensureDirWithApproval } from '../utils/paths';

interface HistoryEntry {
  timestamp: string;
  command: 'expert' | 'generate';
  question?: string;
  patterns: string[];
  projectPath: string;
  projectName: string;
  fileCount?: number;
  tokenCount?: number;
  model?: string;
  gitCommit?: string;
}

const HISTORY_FILE = path.join(
  process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
  'promptcode',
  'history.jsonl'
);

const MAX_HISTORY_ENTRIES = 100;

/**
 * Ensure history directory exists
 */
async function ensureHistoryDir(): Promise<void> {
  const dir = path.dirname(HISTORY_FILE);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
}

/**
 * Get current git commit hash if in a git repository
 */
async function getGitCommit(projectPath: string): Promise<string | undefined> {
  try {
    // Validate path to prevent command injection
    const resolvedPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
      return undefined;
    }
    
    const { execSync } = await import('child_process');
    const commit = execSync('git rev-parse --short HEAD', {
      cwd: resolvedPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return commit;
  } catch {
    return undefined;
  }
}

/**
 * Log a command run to history
 */
export async function logRun(
  command: 'expert' | 'generate',
  patterns: string[],
  projectPath: string,
  options: {
    question?: string;
    fileCount?: number;
    tokenCount?: number;
    model?: string;
  } = {}
): Promise<void> {
  try {
    await ensureHistoryDir();
    
    const entry: HistoryEntry = {
      timestamp: new Date().toISOString(),
      command,
      patterns,
      projectPath,
      projectName: path.basename(projectPath),
      gitCommit: await getGitCommit(projectPath),
      ...options
    };
    
    // Append to history file
    await fs.promises.appendFile(HISTORY_FILE, JSON.stringify(entry) + '\n');
    
    // Trim history file if it gets too large
    await trimHistory();
  } catch (error) {
    // Silently fail - history is non-critical
    // console.debug('Failed to log history:', error);
  }
}

/**
 * Trim history file to keep only recent entries
 */
async function trimHistory(): Promise<void> {
  try {
    const content = await fs.promises.readFile(HISTORY_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(line => line);
    
    if (lines.length > MAX_HISTORY_ENTRIES) {
      const trimmed = lines.slice(-MAX_HISTORY_ENTRIES);
      await fs.promises.writeFile(HISTORY_FILE, trimmed.join('\n') + '\n');
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Read history entries
 */
export async function readHistory(limit?: number): Promise<HistoryEntry[]> {
  try {
    await ensureHistoryDir();
    
    if (!fs.existsSync(HISTORY_FILE)) {
      return [];
    }
    
    const content = await fs.promises.readFile(HISTORY_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(line => line);
    
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip invalid entries
      }
    }
    
    // Return most recent first
    entries.reverse();
    
    return limit ? entries.slice(0, limit) : entries;
  } catch {
    return [];
  }
}

/**
 * Get a specific history entry
 */
export async function getHistoryEntry(index: number): Promise<HistoryEntry | null> {
  const entries = await readHistory();
  return entries[index] || null;
}

/**
 * Convert history entry to preset
 */
export async function historyToPreset(
  index: number,
  presetName: string,
  projectPath: string
): Promise<void> {
  const entry = await getHistoryEntry(index);
  if (!entry) {
    throw new Error(`History entry ${index} not found`);
  }
  
  // Find existing .promptcode or use current directory
  const existingPromptcodeDir = findPromptcodeFolder(projectPath);
  const presetDir = existingPromptcodeDir 
    ? path.join(existingPromptcodeDir, 'presets')
    : path.join(projectPath, '.promptcode', 'presets');
  
  // Ensure directory exists with approval
  const dirCreated = await ensureDirWithApproval(presetDir, '.promptcode/presets');
  if (!dirCreated) {
    throw new Error('Cannot create preset without directory approval');
  }
  
  const presetPath = path.join(presetDir, `${presetName}.patterns`);
  const presetContent = `# ${presetName} preset
# Created from history entry ${index}
# Original timestamp: ${entry.timestamp}
# Original question: ${entry.question || 'N/A'}
# Original project: ${entry.projectName}

${entry.patterns.join('\n')}
`;
  
  await fs.promises.writeFile(presetPath, presetContent);
}