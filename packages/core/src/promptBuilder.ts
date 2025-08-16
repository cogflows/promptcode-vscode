import * as fs from 'fs';
import * as path from 'path';
import { SelectedFile } from './types/index.js';
import { countTokens } from './tokenCounter.js';
import { buildTreeFromSelection } from './utils/buildTreeFromSelection.js';

export interface PromptOptions {
  includeFiles: boolean;
  includeInstructions: boolean;
  includeFileContents?: boolean;  // Default true if includeFiles is true
}

export interface PromptResult {
  prompt: string;
  tokenCount: number;
  sections: {
    instructions: number;
    fileMap: number;
    fileContents: number;
    resources: number;
  };
}

/**
 * Read file content
 * @param filePath Absolute path to file
 * @returns File content as string
 */
async function readFileContent(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    throw new Error(`Could not read file: ${filePath}`);
  }
}

/**
 * Build a structured prompt from selected files and instructions
 * @param selectedFiles Array of selected files with metadata
 * @param instructions User instructions or template content
 * @param options Options for what to include in the prompt
 * @returns Prompt result with token counts
 */
export async function buildPrompt(
  selectedFiles: SelectedFile[],
  instructions: string,
  options: PromptOptions
): Promise<PromptResult> {
  let finalPromptText = '';
  const sections = {
    instructions: 0,
    fileMap: 0,
    fileContents: 0,
    resources: 0
  };

  // 1. Add Instructions
  if (options.includeInstructions && instructions) {
    const instructionSection = `<instructions>\n${instructions}\n</instructions>\n\n`;
    finalPromptText += instructionSection;
    sections.instructions = countTokens(instructionSection);
  }

  // 2. Generate File Map
  if (options.includeFiles) {
    try {
      const fileMapContent = buildTreeFromSelection(selectedFiles);
      const fileMapSection = `<file_map>\n${fileMapContent}</file_map>\n\n`;
      finalPromptText += fileMapSection;
      sections.fileMap = countTokens(fileMapSection);
    } catch (error) {
      console.error('Error generating file map:', error);
      const errorSection = '<file_map>\n<!-- Error generating file map -->\n</file_map>\n\n';
      finalPromptText += errorSection;
      sections.fileMap = countTokens(errorSection);
    }
  }

  // 3. Add File Contents
  if (options.includeFiles && options.includeFileContents !== false) {
    let fileContentsSection = '<file_contents>\n';
    
    for (const file of selectedFiles) {
      try {
        const fileContent = file.content ?? await readFileContent(file.absolutePath);
        const relativePath = file.path;
        
        fileContentsSection += `File: ${relativePath} (${file.tokenCount} tokens)\n`;
        fileContentsSection += '```\n';
        fileContentsSection += fileContent;
        fileContentsSection += '\n```\n\n';
      } catch (error) {
        console.error(`Error adding file content for ${file.absolutePath}:`, error);
        fileContentsSection += `File: ${file.path}\n<!-- Error reading file content: ${(error as Error).message} -->\n\n`;
      }
    }
    
    fileContentsSection += '</file_contents>\n\n';
    finalPromptText += fileContentsSection;
    sections.fileContents = countTokens(fileContentsSection);
  }

  // Ensure final newline
  if (finalPromptText && !finalPromptText.endsWith('\n')) {
    finalPromptText += '\n';
  }

  const totalTokenCount = countTokens(finalPromptText);

  return {
    prompt: finalPromptText,
    tokenCount: totalTokenCount,
    sections
  };
}