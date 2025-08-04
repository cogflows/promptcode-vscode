import * as path from 'path';
import * as fs from 'fs';
import { scanFiles, buildPrompt, initializeTokenCounter } from '@promptcode/core';
import chalk from 'chalk';
import ora from 'ora';
import { logRun } from '../services/history';

export interface GenerateOptions {
  path?: string;
  files?: string[];
  noGitignore?: boolean;
  instructions?: string;
  template?: string;
  out?: string;
  json?: boolean;
  ignoreFile?: string;
  list?: string;
  savePreset?: string;
}

/**
 * Load instructions from file
 * @param instructionsPath Path to instructions file
 * @returns Instructions content
 */
async function loadInstructions(instructionsPath: string): Promise<string> {
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
async function loadFileList(listPath: string, basePath: string): Promise<string[]> {
  let resolvedPath = listPath;
  
  // If the file doesn't exist directly, try looking for it as a preset
  if (!fs.existsSync(listPath)) {
    // Try in .promptcode/presets/
    const presetDir = path.join(basePath, '.promptcode', 'presets');
    
    // Add .patterns extension if not present
    const filename = listPath.endsWith('.patterns') ? listPath : `${listPath}.patterns`;
    const presetPath = path.join(presetDir, filename);
    
    if (fs.existsSync(presetPath)) {
      resolvedPath = presetPath;
      console.log(chalk.gray(`Using preset: ${filename}`));
    } else {
      // Also try without adding extension in case it's a full filename
      const altPresetPath = path.join(presetDir, listPath);
      if (fs.existsSync(altPresetPath)) {
        resolvedPath = altPresetPath;
        console.log(chalk.gray(`Using preset: ${listPath}`));
      }
    }
  }
  
  try {
    const content = await fs.promises.readFile(resolvedPath, 'utf8');
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
    throw new Error(`Failed to read file list: ${resolvedPath}`);
  }
}

/**
 * Load template from built-in or user templates
 * @param templateName Template name
 * @param templateDir Optional template directory
 * @returns Template content
 */
async function loadTemplate(templateName: string, templateDir?: string): Promise<string> {
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
 * Generate command implementation
 * @param options Command options
 */
export async function generateCommand(options: GenerateOptions): Promise<void> {
  const spinner = ora('Initializing...').start();
  
  try {
    // Initialize token counter with cache
    const cacheDir = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '', '.cache', 'promptcode');
    initializeTokenCounter(cacheDir, '0.1.0');
    
    // Determine project path
    const projectPath = path.resolve(options.path || process.cwd());
    
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }
    
    spinner.text = 'Loading configuration...';
    
    // Load instructions
    let instructions = '';
    if (options.instructions) {
      instructions = await loadInstructions(options.instructions);
    } else if (options.template) {
      const templateDir = process.env.XDG_CONFIG_HOME 
        ? path.join(process.env.XDG_CONFIG_HOME, 'promptcode/prompts')
        : path.join(process.env.HOME || '', '.config/promptcode/prompts');
      instructions = await loadTemplate(options.template, templateDir);
    }
    
    // Determine file patterns
    let patterns: string[] = options.files || ['**/*'];
    if (options.list) {
      patterns = await loadFileList(options.list, projectPath);
    }
    
    // Save preset if requested
    if (options.savePreset && patterns.length > 0) {
      const presetDir = path.join(projectPath, '.promptcode', 'presets');
      await fs.promises.mkdir(presetDir, { recursive: true });
      const presetPath = path.join(presetDir, `${options.savePreset}.patterns`);
      
      // Check if preset exists
      if (fs.existsSync(presetPath)) {
        // In non-TTY environments, fail to avoid accidental overwrites
        if (!process.stdout.isTTY) {
          throw new Error(`Preset '${options.savePreset}' already exists. Remove it first or choose a different name.`);
        }
        // In TTY, we could ask for confirmation, but for now just notify
        console.log(chalk.yellow(`⚠️  Overwriting existing preset: ${options.savePreset}`));
      }
      
      // Write the preset file
      const presetContent = `# ${options.savePreset} preset\n# Created: ${new Date().toISOString()}\n# Generated from promptcode\n\n${patterns.join('\n')}\n`;
      await fs.promises.writeFile(presetPath, presetContent);
      console.log(chalk.green(`✓ Saved file patterns to preset: ${options.savePreset}`));
    }
    
    spinner.text = 'Scanning files...';
    
    // Scan files
    const selectedFiles = await scanFiles({
      cwd: projectPath,
      patterns,
      respectGitignore: !options.noGitignore,
      customIgnoreFile: options.ignoreFile || path.join(projectPath, '.promptcode_ignore'),
      workspaceName: path.basename(projectPath)
    });
    
    if (selectedFiles.length === 0) {
      spinner.fail('No files found matching the specified patterns');
      return;
    }
    
    spinner.text = `Building prompt for ${selectedFiles.length} files...`;
    
    // Build prompt
    const result = await buildPrompt(selectedFiles, instructions, {
      includeFiles: true,
      includeInstructions: !!instructions,
      includeFileContents: true
    });
    
    spinner.succeed(`Generated prompt with ${result.tokenCount} tokens`);
    
    // Log to history
    await logRun('generate', patterns, projectPath, {
      fileCount: selectedFiles.length,
      tokenCount: result.tokenCount
    });
    
    // Output results
    if (options.json) {
      const jsonOutput = {
        prompt: result.prompt,
        tokenCount: result.tokenCount,
        sections: result.sections,
        files: selectedFiles.map(f => ({
          path: f.path,
          tokens: f.tokenCount
        }))
      };
      
      if (options.out) {
        await fs.promises.writeFile(options.out, JSON.stringify(jsonOutput, null, 2));
        console.log(chalk.green(`✓ Saved JSON output to ${options.out}`));
      } else {
        console.log(JSON.stringify(jsonOutput, null, 2));
      }
    } else {
      if (options.out) {
        await fs.promises.writeFile(options.out, result.prompt);
        console.log(chalk.green(`✓ Saved prompt to ${options.out}`));
        console.log(chalk.gray(`  Token count: ${result.tokenCount}`));
        console.log(chalk.gray(`  Files included: ${selectedFiles.length}`));
      } else {
        console.log(result.prompt);
        // Add a helpful tip about saving outputs
        if (!options.json && selectedFiles.length > 5) {
          console.error(chalk.gray('\nTip: Consider saving large outputs with -o .promptcode/outputs/<name>.md'));
        }
      }
    }
    
  } catch (error) {
    spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}