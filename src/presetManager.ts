import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode'; // Added vscode import for error handling
import { FilePreset } from './types/filePreset';

// Directory structure
const PRESET_DIR = '.promptcode/presets';
const PRESET_LEGACY_EXT = '.json';
const PRESET_PATTERN_EXT = '.patterns';

/**
 * Find .promptcode folder in current or parent directories
 * Similar to how git finds .git folder
 */
function findPromptcodeFolder(startPath: string): string | null {
  let currentPath = path.resolve(startPath);
  const root = path.parse(currentPath).root;
  
  while (currentPath !== root) {
    const candidatePath = path.join(currentPath, '.promptcode');
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {break;} // Reached root
    currentPath = parentPath;
  }
  
  return null;
}

/**
 * Gets the full path to the presets directory.
 * Now searches for existing .promptcode in parent directories
 */
function getPresetsDirectory(workspaceRoot: string): string {
  const existingPromptcodeDir = findPromptcodeFolder(workspaceRoot);
  if (existingPromptcodeDir) {
    return path.join(existingPromptcodeDir, 'presets');
  }
  // Default to creating in current project directory
  return path.join(workspaceRoot, PRESET_DIR);
}

/**
 * Gets the file path for a specific preset.
 * @param workspaceRoot The workspace root path
 * @param presetName The preset name
 * @param usePatternFormat Whether to use the new pattern format (default: true)
 */
function getPresetFilePath(workspaceRoot: string, presetName: string, usePatternFormat: boolean = true): string {
  // Convert the preset name to a safe filename by removing invalid chars and replacing spaces with underscores
  const safeFileName = presetName
    .replace(/[/\\?%*:|"<>]/g, '-') // Replace invalid filename chars with dash
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .toLowerCase(); // Convert to lowercase for consistency
  
  const extension = usePatternFormat ? PRESET_PATTERN_EXT : PRESET_LEGACY_EXT;
  return path.join(getPresetsDirectory(workspaceRoot), `${safeFileName}${extension}`);
}

/**
 * Loads all the presets from individual files in the presets directory.
 */
export function loadPresets(workspaceRoot: string): FilePreset[] {
  const presetsDir = getPresetsDirectory(workspaceRoot);
  const presets: FilePreset[] = [];

  try {
    // Create the directory if it doesn't exist
    if (!fs.existsSync(presetsDir)) {
      return []; // No presets yet
    }

    // Get all preset files
    const allFiles = fs.readdirSync(presetsDir);
    const patternFiles = allFiles.filter(f => f.endsWith(PRESET_PATTERN_EXT));
    const jsonFiles = allFiles.filter(f => f.endsWith(PRESET_LEGACY_EXT));

    // 1. Load new pattern presets
    for (const file of patternFiles) {
      const name = path.basename(file, PRESET_PATTERN_EXT);
      presets.push({
        name,
        patternFile: path.join(presetsDir, file)
      });
    }

    // 2. Load legacy JSON presets
    for (const file of jsonFiles) {
      try {
        const presetPath = path.join(presetsDir, file);
        const content = fs.readFileSync(presetPath, 'utf8');
        const preset = JSON.parse(content);

        // Basic validation to ensure it has the required fields
        if (preset && typeof preset.name === 'string' && Array.isArray(preset.files)) {
          presets.push({
            ...preset,
            legacyFile: file
          });
        } else {
          console.warn(`Invalid format in preset file ${file}. Skipping.`);
        }
      } catch (error) {
        console.error(`Error reading preset file ${file}:`, error);
      }
    }

    // Sort by name for consistent order
    return presets.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error loading presets:', error);
    vscode.window.showErrorMessage(`Error loading presets: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Request user approval for directory creation
 */
async function requestDirectoryCreation(dirPath: string): Promise<boolean> {
  const relativePath = vscode.workspace.asRelativePath(dirPath, false);
  const result = await vscode.window.showInformationMessage(
    `PromptCode needs to create the following directory:\n${relativePath}\n\nWould you like to create it?`,
    { modal: true },
    'Yes',
    'No'
  );
  return result === 'Yes';
}

/**
 * Ensure directory exists with user approval
 */
async function ensureDirWithApproval(dirPath: string): Promise<boolean> {
  if (fs.existsSync(dirPath)) {
    return true;
  }

  const approved = await requestDirectoryCreation(dirPath);
  if (approved) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      vscode.window.showInformationMessage(`Created directory: ${vscode.workspace.asRelativePath(dirPath, false)}`);
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create directory: ${error}`);
      return false;
    }
  }
  return false;
}

/**
 * Saves a preset to its own file in the presets directory.
 */
export async function savePreset(workspaceRoot: string, preset: FilePreset): Promise<void> {
  try {
    const presetsDir = getPresetsDirectory(workspaceRoot);
    
    // Ensure the presets directory exists with approval
    if (!fs.existsSync(presetsDir)) {
      const created = await ensureDirWithApproval(presetsDir);
      if (!created) {
        vscode.window.showErrorMessage('Cannot save preset without creating directory');
        return;
      }
    }

    // Get the file path for this preset
    const presetFilePath = getPresetFilePath(workspaceRoot, preset.name);
    
    // Write the preset to its own file
    fs.writeFileSync(presetFilePath, JSON.stringify(preset, null, 2), 'utf8');
    
    console.log(`Saved preset "${preset.name}" to ${presetFilePath}`);
  } catch (error) {
    console.error('Error saving preset:', error);
    vscode.window.showErrorMessage(`Error saving preset: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Saves a preset in the new pattern format.
 */
export async function savePatternPreset(workspaceRoot: string, presetName: string, patterns: string[]): Promise<void> {
  try {
    const presetsDir = getPresetsDirectory(workspaceRoot);
    
    // Ensure the presets directory exists with approval
    if (!fs.existsSync(presetsDir)) {
      const created = await ensureDirWithApproval(presetsDir);
      if (!created) {
        vscode.window.showErrorMessage('Cannot save preset without creating directory');
        return;
      }
    }

    // Get the file path for this preset
    const presetFilePath = getPresetFilePath(workspaceRoot, presetName, true);
    
    // Write the patterns to the file (one per line)
    const content = patterns.join('\n') + '\n'; // Add trailing newline
    fs.writeFileSync(presetFilePath, content, 'utf8');
    
    console.log(`Saved pattern preset "${presetName}" to ${presetFilePath}`);
  } catch (error) {
    console.error('Error saving pattern preset:', error);
    vscode.window.showErrorMessage(`Error saving preset: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// The savePresets function is kept for backward compatibility, but now
// it will save each preset to its own file
export async function savePresets(workspaceRoot: string, presets: FilePreset[]): Promise<void> {
  for (const preset of presets) {
    await savePreset(workspaceRoot, preset);
  }
} 