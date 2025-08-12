import * as path from 'path';
import * as fs from 'fs';
import { findUpDirectory, findUpFile } from './find-up';

/**
 * List of PromptCode Cursor MDC files
 */
export const PROMPTCODE_CURSOR_RULES = [
  'promptcode-usage.mdc',
  'promptcode-preset-list.mdc',
  'promptcode-preset-info.mdc',
  'promptcode-preset-create.mdc',
  'promptcode-preset-to-prompt.mdc',
  'promptcode-ask-expert.mdc'
];

/**
 * Find .cursor folder in the project or its parent directories
 * Stops at home directory to avoid going too high up
 */
export function findCursorFolder(startPath: string): string | null {
  return findUpDirectory('.cursor', startPath);
}

/**
 * Find .cursorrules file (legacy support)
 * Stops at home directory to avoid going too high up
 */
export function findCursorRulesFile(startPath: string): string | null {
  return findUpFile('.cursorrules', startPath);
}

/**
 * Remove PromptCode section from .cursorrules (legacy)
 */
export async function removeFromCursorRules(projectPath: string): Promise<boolean> {
  const cursorRulesPath = findCursorRulesFile(projectPath);
  if (!cursorRulesPath || !fs.existsSync(cursorRulesPath)) {
    return false;
  }
  
  const content = await fs.promises.readFile(cursorRulesPath, 'utf8');
  
  // Check if PromptCode section exists
  if (!content.includes('<!-- PROMPTCODE-CURSOR-START -->')) {
    return false;
  }
  
  // Remove the PromptCode section (handle both Unix and Windows line endings)
  const updatedContent = content.replace(
    /<!-- PROMPTCODE-CURSOR-START -->[\s\S]*?<!-- PROMPTCODE-CURSOR-END -->\r?\n?/g,
    ''
  );
  
  // Clean up extra newlines
  const cleanedContent = updatedContent.replace(/\n{3,}/g, '\n\n').trim();
  
  if (cleanedContent) {
    await fs.promises.writeFile(cursorRulesPath, cleanedContent + '\n');
    console.log(`✓ Removed PromptCode section from ${path.relative(projectPath, cursorRulesPath)}`);
  } else {
    // File is empty after removal, delete it
    await fs.promises.unlink(cursorRulesPath);
    console.log(`✓ Removed empty ${path.relative(projectPath, cursorRulesPath)}`);
  }
  
  return true;
}

/**
 * Remove PromptCode MDC files from .cursor/rules
 */
export async function removePromptCodeRules(projectPath: string): Promise<boolean> {
  const cursorDir = findCursorFolder(projectPath);
  if (!cursorDir) {
    return false;
  }
  
  const rulesDir = path.join(cursorDir, 'rules');
  if (!fs.existsSync(rulesDir)) {
    return false;
  }
  
  let removed = false;
  
  for (const rule of PROMPTCODE_CURSOR_RULES) {
    const rulePath = path.join(rulesDir, rule);
    if (fs.existsSync(rulePath)) {
      await fs.promises.unlink(rulePath);
      console.log(`  Removed: ${rule}`);
      removed = true;
    }
  }
  
  if (removed) {
    // Check if rules directory is empty and remove if so
    try {
      const files = await fs.promises.readdir(rulesDir);
      if (files.length === 0) {
        await fs.promises.rm(rulesDir, { recursive: false, force: true });
        console.log('✓ Removed empty rules directory');
      }
    } catch (error) {
      // Directory might not exist or have other files
    }
    
    console.log('✓ Removed PromptCode rules from .cursor/rules/');
  }
  
  return removed;
}

/**
 * Remove PromptCode from MCP configuration
 */
export async function removeFromMcpConfig(projectPath: string, global = false): Promise<boolean> {
  const mcpPath = global
    ? path.join(process.env.HOME || '', '.cursor', 'mcp.json')
    : path.join(findCursorFolder(projectPath) || path.join(projectPath, '.cursor'), 'mcp.json');
  
  if (!fs.existsSync(mcpPath)) {
    return false;
  }
  
  try {
    const content = await fs.promises.readFile(mcpPath, 'utf8');
    const config = JSON.parse(content);
    
    if (config.mcpServers?.promptcode) {
      delete config.mcpServers.promptcode;
      
      // Clean up empty structures
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }
      
      // Write back or remove file
      if (Object.keys(config).length === 0) {
        await fs.promises.unlink(mcpPath);
        console.log(`✓ Removed empty ${path.basename(mcpPath)}`);
      } else {
        await fs.promises.writeFile(mcpPath, JSON.stringify(config, null, 2));
        console.log(`✓ Removed PromptCode from ${path.basename(mcpPath)}`);
      }
      
      return true;
    }
  } catch (error) {
    // Invalid JSON or other error
  }
  
  return false;
}

// Removed duplicate getCursorTemplatesDir - use the one from utils/paths instead