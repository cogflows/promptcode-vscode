import * as fs from 'fs';
import * as path from 'path';
import { getPresetDir, ensureDir } from './paths';

/**
 * Load a preset from the project's preset directory
 * @param name The preset name (without .patterns extension)
 * @param projectPath The project root path
 * @returns Array of file patterns
 */
export async function loadPreset(name: string, projectPath: string): Promise<string[]> {
  const presetPath = path.join(getPresetDir(projectPath), `${name}.patterns`);
  
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Preset not found: ${name}`);
  }
  
  const content = await fs.promises.readFile(presetPath, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

/**
 * Save a preset to the project's preset directory
 * @param name The preset name (without .patterns extension)
 * @param patterns Array of file patterns
 * @param projectPath The project root path
 * @param options Save options
 */
export async function savePreset(
  name: string, 
  patterns: string[], 
  projectPath: string,
  options: { overwrite?: boolean } = {}
): Promise<void> {
  const presetDir = getPresetDir(projectPath);
  const presetPath = path.join(presetDir, `${name}.patterns`);
  
  // Check if preset exists and we're not in overwrite mode
  if (fs.existsSync(presetPath) && !options.overwrite) {
    if (!process.stdout.isTTY) {
      throw new Error(`Preset '${name}' already exists. Remove it first or choose a different name.`);
    }
    // In TTY mode, we could prompt for confirmation here
    // For now, we'll just overwrite with a warning (handled by caller)
  }
  
  await ensureDir(presetDir);
  
  const content = [
    `# ${name} preset`,
    `# Created: ${new Date().toISOString()}`,
    `# Generated from promptcode`,
    '',
    ...patterns,
    ''
  ].join('\n');
  
  await fs.promises.writeFile(presetPath, content);
}

/**
 * List all presets in a project
 * @param projectPath The project root path
 * @returns Array of preset names (without .patterns extension)
 */
export async function listPresets(projectPath: string): Promise<string[]> {
  const presetDir = getPresetDir(projectPath);
  
  if (!fs.existsSync(presetDir)) {
    return [];
  }
  
  const files = await fs.promises.readdir(presetDir);
  return files
    .filter(f => f.endsWith('.patterns'))
    .map(f => f.replace('.patterns', ''));
}

/**
 * Delete a preset
 * @param name The preset name (without .patterns extension)
 * @param projectPath The project root path
 */
export async function deletePreset(name: string, projectPath: string): Promise<void> {
  const presetPath = path.join(getPresetDir(projectPath), `${name}.patterns`);
  
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Preset not found: ${name}`);
  }
  
  await fs.promises.unlink(presetPath);
}