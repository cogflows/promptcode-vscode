import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { loadPreset, savePreset } from './presets';
import { getConfigDir } from './paths';

/**
 * Load instructions from file
 * @param instructionsPath Path to instructions file
 * @returns Instructions content
 */
export async function loadInstructions(instructionsPath: string): Promise<string> {
  try {
    return await fs.promises.readFile(instructionsPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read instructions file: ${instructionsPath}`);
  }
}

/**
 * Load file list from plain text file or preset
 * @param listPath Path to file list or preset name
 * @param basePath Base path to resolve relative paths
 * @returns Array of file patterns
 */
export async function loadFileList(listPath: string, basePath: string): Promise<string[]> {
  // If the file doesn't exist directly, try loading as a preset
  if (!fs.existsSync(listPath)) {
    try {
      const patterns = await loadPreset(listPath, basePath);
      console.log(chalk.gray(`Using preset: ${listPath}`));
      return patterns;
    } catch {
      // Not a preset, continue with file loading
    }
  }
  
  // Load as a regular file
  try {
    const content = await fs.promises.readFile(listPath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(file => {
        // Convert relative paths to absolute
        if (!path.isAbsolute(file)) {
          return path.join(basePath, file);
        }
        return file;
      });
  } catch (error) {
    throw new Error(`Failed to read file list: ${listPath}`);
  }
}

/**
 * Load template from built-in or user templates
 * @param templateName Template name
 * @param templateDir Optional template directory
 * @returns Template content
 */
export async function loadTemplate(templateName: string, templateDir?: string): Promise<string> {
  // Try user templates first
  if (templateDir) {
    const userTemplatePath = path.join(templateDir, `${templateName}.md`);
    try {
      return await fs.promises.readFile(userTemplatePath, 'utf8');
    } catch {
      // Fall back to built-in templates
    }
  }

  // Try built-in templates
  const builtInPath = path.join(__dirname, '../../assets/prompts', `${templateName}.md`);
  try {
    return await fs.promises.readFile(builtInPath, 'utf8');
  } catch {
    throw new Error(`Template not found: ${templateName}`);
  }
}

/**
 * Load instructions from options (file or template)
 */
export async function loadInstructionsFromOptions(options: { instructions?: string; template?: string }): Promise<string> {
  if (options.instructions) {
    return loadInstructions(options.instructions);
  }
  if (options.template) {
    const templateDir = path.join(getConfigDir(), 'prompts');
    return loadTemplate(options.template, templateDir);
  }
  return '';
}

/**
 * Get patterns from options (list file or direct patterns)
 */
export async function getPatternsFromOptions(options: { list?: string; files?: string[] }, projectPath: string): Promise<string[]> {
  if (options.list) {
    return loadFileList(options.list, projectPath);
  }
  return options.files || ['**/*'];
}

/**
 * Handle preset saving with overwrite logic
 */
export async function handlePresetSave(name: string, patterns: string[], projectPath: string, isJson?: boolean): Promise<void> {
  try {
    await savePreset(name, patterns, projectPath, { overwrite: process.stdout.isTTY });
    if (!isJson) console.log(chalk.green(`✓ Saved file patterns to preset: ${name}`));
  } catch (error) {
    const presetPath = path.join(projectPath, '.promptcode', 'presets', `${name}.patterns`);
    if (!isJson && fs.existsSync(presetPath)) {
      console.log(chalk.yellow(`⚠️  Overwriting existing preset: ${name}`));
      await savePreset(name, patterns, projectPath, { overwrite: true });
      if (!isJson) console.log(chalk.green(`✓ Saved file patterns to preset: ${name}`));
    } else {
      throw error;
    }
  }
}