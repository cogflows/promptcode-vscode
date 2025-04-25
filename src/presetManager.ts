import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode'; // Added vscode import for error handling
import { FilePreset } from './types/filePreset';

// Directory structure
const PRESET_DIR = '.promptcode/presets';

/**
 * Gets the full path to the presets directory.
 */
function getPresetsDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, PRESET_DIR);
}

/**
 * Gets the file path for a specific preset.
 */
function getPresetFilePath(workspaceRoot: string, presetName: string): string {
  // Convert the preset name to a safe filename by removing invalid chars and replacing spaces with underscores
  const safeFileName = presetName
    .replace(/[/\\?%*:|"<>]/g, '-') // Replace invalid filename chars with dash
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .toLowerCase(); // Convert to lowercase for consistency
  
  return path.join(getPresetsDirectory(workspaceRoot), `${safeFileName}.json`);
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

    // Get all JSON files from the presets directory
    const presetFiles = fs.readdirSync(presetsDir)
      .filter(file => file.endsWith('.json'));

    // Load each preset file
    for (const presetFile of presetFiles) {
      try {
        const presetPath = path.join(presetsDir, presetFile);
        const content = fs.readFileSync(presetPath, 'utf8');
        const preset = JSON.parse(content);

        // Basic validation to ensure it has the required fields
        if (preset && typeof preset.name === 'string' && Array.isArray(preset.files)) {
          presets.push(preset);
        } else {
          console.warn(`Invalid format in preset file ${presetFile}. Skipping.`);
        }
      } catch (error) {
        console.error(`Error reading preset file ${presetFile}:`, error);
      }
    }

    return presets;
  } catch (error) {
    console.error('Error loading presets:', error);
    vscode.window.showErrorMessage(`Error loading presets: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Saves a preset to its own file in the presets directory.
 */
export function savePreset(workspaceRoot: string, preset: FilePreset): void {
  try {
    const presetsDir = getPresetsDirectory(workspaceRoot);
    
    // Ensure the presets directory exists
    if (!fs.existsSync(presetsDir)) {
      fs.mkdirSync(presetsDir, { recursive: true });
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

// The savePresets function is kept for backward compatibility, but now
// it will save each preset to its own file
export function savePresets(workspaceRoot: string, presets: FilePreset[]): void {
  for (const preset of presets) {
    savePreset(workspaceRoot, preset);
  }
} 