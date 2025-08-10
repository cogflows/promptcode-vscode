import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { scanFiles, SelectedFile } from '@promptcode/core';

interface ContextOptions {
  path: string;
  save?: string;
  load?: string;
}

const CONTEXT_FILE = '.promptcode/context.json';
const SAVED_CONTEXTS_DIR = '.promptcode/contexts';

interface ContextState {
  files: string[];
  lastModified: string;
}

interface SavedContext extends ContextState {
  name: string;
  description?: string;
}

export async function contextCommand(action: string, files: string[], options: ContextOptions) {
  const contextPath = path.join(options.path, CONTEXT_FILE);
  const contextsDir = path.join(options.path, SAVED_CONTEXTS_DIR);
  
  try {
    switch (action) {
      case 'add':
        await addToContext(files, options.path, contextPath);
        break;
        
      case 'remove':
      case 'rm':
        await removeFromContext(files, options.path, contextPath);
        break;
        
      case 'list':
      case 'ls':
        await listContext(contextPath, options);
        break;
        
      case 'clear':
        await clearContext(contextPath);
        break;
        
      case 'save':
        if (!options.save) {
          console.error(chalk.red('Error: --save <name> required'));
          process.exit(1);
        }
        await saveContext(contextPath, contextsDir, options.save);
        break;
        
      case 'load':
        if (!options.load) {
          console.error(chalk.red('Error: --load <name> required'));
          process.exit(1);
        }
        await loadSavedContext(contextPath, contextsDir, options.load);
        break;
        
      case 'saved':
        await listSavedContexts(contextsDir);
        break;
        
      default:
        console.error(chalk.red(`Unknown action: ${action}`));
        console.log('Available actions: add, remove, list, clear, save, load, saved');
        process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

async function loadContextState(contextPath: string): Promise<ContextState> {
  try {
    const content = await fs.readFile(contextPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { files: [], lastModified: new Date().toISOString() };
  }
}

async function saveContextState(contextPath: string, state: ContextState) {
  await fs.mkdir(path.dirname(contextPath), { recursive: true });
  await fs.writeFile(contextPath, JSON.stringify(state, null, 2));
}

async function addToContext(patterns: string[], projectPath: string, contextPath: string) {
  if (patterns.length === 0) {
    console.error(chalk.red('Error: No file patterns provided'));
    process.exit(1);
  }
  
  const context = await loadContextState(contextPath);
  const newFiles = new Set(context.files);
  
  // Scan files matching patterns
  const scanned = await scanFiles({
    cwd: projectPath,
    patterns,
    respectGitignore: true,
    workspaceName: path.basename(projectPath)
  });
  
  let added = 0;
  for (const file of scanned) {
    if (!newFiles.has(file.path)) {
      newFiles.add(file.path);
      added++;
    }
  }
  
  context.files = Array.from(newFiles).sort();
  context.lastModified = new Date().toISOString();
  
  await saveContextState(contextPath, context);
  
  console.log(chalk.green(`✓ Added ${added} files to context`));
  console.log(chalk.gray(`Total files in context: ${context.files.length}`));
}

async function removeFromContext(patterns: string[], projectPath: string, contextPath: string) {
  if (patterns.length === 0) {
    console.error(chalk.red('Error: No file patterns provided'));
    process.exit(1);
  }
  
  const context = await loadContextState(contextPath);
  const filesSet = new Set(context.files);
  const originalSize = filesSet.size;
  
  // If patterns include glob characters, match against them
  for (const pattern of patterns) {
    if (pattern.includes('*') || pattern.includes('?')) {
      // Use minimatch or similar
      const { minimatch } = await import('minimatch');
      context.files.forEach(file => {
        if (minimatch(file, pattern)) {
          filesSet.delete(file);
        }
      });
    } else {
      // Direct path match
      filesSet.delete(pattern);
    }
  }
  
  const removed = originalSize - filesSet.size;
  context.files = Array.from(filesSet).sort();
  context.lastModified = new Date().toISOString();
  
  await saveContextState(contextPath, context);
  
  console.log(chalk.green(`✓ Removed ${removed} files from context`));
  console.log(chalk.gray(`Remaining files in context: ${context.files.length}`));
}

async function listContext(contextPath: string, options: ContextOptions) {
  const context = await loadContextState(contextPath);
  
  if (context.files.length === 0) {
    console.log(chalk.yellow('Context is empty'));
    return;
  }
  
  console.log(chalk.bold(`Context contains ${context.files.length} files:`));
  console.log(chalk.gray(`Last modified: ${new Date(context.lastModified).toLocaleString()}\n`));
  
  // Group files by directory
  const filesByDir: Record<string, string[]> = {};
  let totalTokens = 0;
  
  for (const file of context.files) {
    const dir = path.dirname(file) || '.';
    if (!filesByDir[dir]) {
      filesByDir[dir] = [];
    }
    filesByDir[dir].push(path.basename(file));
  }
  
  // Display grouped files
  for (const [dir, files] of Object.entries(filesByDir).sort()) {
    console.log(chalk.cyan(`${dir}/`));
    for (const file of files.sort()) {
      console.log(`  ${file}`);
    }
  }
  
  // If --json option in future, could output JSON format
}

async function clearContext(contextPath: string) {
  await saveContextState(contextPath, {
    files: [],
    lastModified: new Date().toISOString()
  });
  console.log(chalk.green('✓ Context cleared'));
}

async function saveContext(contextPath: string, contextsDir: string, name: string) {
  const context = await loadContextState(contextPath);
  
  if (context.files.length === 0) {
    console.error(chalk.red('Error: Cannot save empty context'));
    process.exit(1);
  }
  
  const savedContext: SavedContext = {
    ...context,
    name,
    description: `Saved on ${new Date().toLocaleString()}`
  };
  
  await fs.mkdir(contextsDir, { recursive: true });
  const savePath = path.join(contextsDir, `${name}.json`);
  await fs.writeFile(savePath, JSON.stringify(savedContext, null, 2));
  
  console.log(chalk.green(`✓ Context saved as "${name}"`));
  console.log(chalk.gray(`Contains ${context.files.length} files`));
}

async function loadSavedContext(contextPath: string, contextsDir: string, name: string) {
  const loadPath = path.join(contextsDir, `${name}.json`);
  
  try {
    const content = await fs.readFile(loadPath, 'utf-8');
    const saved: SavedContext = JSON.parse(content);
    
    const context: ContextState = {
      files: saved.files,
      lastModified: new Date().toISOString()
    };
    
    await saveContextState(contextPath, context);
    
    console.log(chalk.green(`✓ Loaded context "${name}"`));
    console.log(chalk.gray(`Contains ${context.files.length} files`));
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      console.error(chalk.red(`Error: Saved context "${name}" not found`));
      await listSavedContexts(contextsDir);
    } else {
      throw error;
    }
  }
}

async function listSavedContexts(contextsDir: string) {
  try {
    const files = await fs.readdir(contextsDir);
    const contexts = files.filter(f => f.endsWith('.json'));
    
    if (contexts.length === 0) {
      console.log(chalk.yellow('No saved contexts found'));
      return;
    }
    
    console.log(chalk.bold('Saved contexts:'));
    for (const file of contexts) {
      const name = path.basename(file, '.json');
      try {
        const content = await fs.readFile(path.join(contextsDir, file), 'utf-8');
        const saved: SavedContext = JSON.parse(content);
        console.log(`  ${chalk.cyan(name)} - ${saved.files.length} files ${chalk.gray(saved.description || '')}`);
      } catch {
        console.log(`  ${chalk.cyan(name)} ${chalk.red('(corrupted)')}`);
      }
    }
  } catch {
    console.log(chalk.yellow('No saved contexts found'));
  }
}