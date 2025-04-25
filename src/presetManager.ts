import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode'; // Added vscode import for error handling
import { FilePreset } from './types/filePreset';

const PRESET_DIR = '.promptcode';
const PRESET_FILE = 'presets.json';

function getPresetPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, PRESET_DIR, PRESET_FILE);
}

export function loadPresets(workspaceRoot: string): FilePreset[] {
  const presetFilePath = getPresetPath(workspaceRoot);
  try {
    if (!fs.existsSync(presetFilePath)) {
      return []; // Return empty array if file doesn't exist
    }
    const raw = fs.readFileSync(presetFilePath, 'utf8');
    const presets = JSON.parse(raw);
    // Basic validation to ensure it's an array of objects with name and files
    if (!Array.isArray(presets) || presets.some(p => typeof p.name !== 'string' || !Array.isArray(p.files))) {
      console.warn('Invalid presets file format. Returning empty array.');
      vscode.window.showWarningMessage('Invalid format in .promptcode/presets.json. Ignoring presets.');
      return [];
    }
    return presets as FilePreset[];
  } catch (error) {
    console.error('Error loading presets:', error);
    vscode.window.showErrorMessage(`Error loading presets from ${presetFilePath}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export function savePresets(workspaceRoot: string, presets: FilePreset[]) {
  const fullPath = getPresetPath(workspaceRoot);
  const dirPath = path.dirname(fullPath);
  try {
    // Ensure the .promptcode directory exists
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(fullPath, JSON.stringify(presets, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving presets:', error);
    vscode.window.showErrorMessage(`Error saving presets to ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
} 