import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { checkedItems } from './fileExplorer';
import { countTokensWithCache } from './tokenCounter';
import { fetchResourceContent } from './promptcodeDataFetcher';

// Define interfaces for clarity
interface SelectedFile {
    path: string;
    absolutePath: string;
    workspaceFolderName: string;
    workspaceFolderRootPath: string;
    tokenCount: number;
    content?: string; // Content will be added later if needed
}

interface IncludeOptions {
    files: boolean;
    instructions: boolean;
    // Add other options if they exist
}

// HTML Entity Decoding Helper (Simplified)
function decodeHtmlEntities(text: string): string {
    if (!text) return '';
    // Basic decoding for entities used in fetch-instruction
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
}

// Generate a directory tree representation for the prompt
export async function generateDirectoryTree(workspaceFolders: vscode.WorkspaceFolder[]): Promise<string> {
  let result = '';
  
  for (const folder of workspaceFolders) {
    const rootPath = folder.uri.fsPath;
    const rootName = folder.name;
    
    result += `# Workspace: ${rootName}\n`;
    
    // Build the tree recursively for this workspace
    const buildTree = async (dirPath: string, prefix: string = ''): Promise<void> => {
      try {
        // Get all entries in this directory
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        // Sort entries (directories first, then files)
        const sortedEntries = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });
        
        // Process each entry
        for (let i = 0; i < sortedEntries.length; i++) {
          const entry = sortedEntries[i];
          const entryPath = path.join(dirPath, entry.name);
          
          // Skip node_modules, .git, and other common directories/files that should be ignored
          if (entry.name === 'node_modules' || entry.name === '.git') {
            continue;
          }
          
          // Check if this entry is the last one at this level
          const isLast = i === sortedEntries.length - 1;
          
          // Determine the branch character
          const branchChar = isLast ? '└──' : '├──';
          
          // Determine the prefix for the next level
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');
          
          // Get the relative path from workspace root for display
          const relativePath = path.relative(rootPath, entryPath);
          
          if (entry.isDirectory()) {
            // Check if this directory has any selected files before including it
            const hasSelected = await hasSelectedFiles(entryPath);
            if (!hasSelected) continue;
            
            // Add directory entry
            result += `${prefix}${branchChar} ${entry.name}/\n`;
            
            // Recursively process subdirectory
            await buildTree(entryPath, nextPrefix);
          } else {
            // Check if this file is selected
            if (!checkedItems.get(entryPath)) continue;
            
            // Add file entry
            result += `${prefix}${branchChar} ${entry.name} (${relativePath})\n`;
          }
        }
      } catch (error) {
        console.error(`Error building tree for ${dirPath}:`, error);
      }
    };
    
    // Helper function to check if a directory has any selected files
    const hasSelectedFiles = async (dirPath: string): Promise<boolean> => {
      try {
        // Check if this directory itself is selected
        if (checkedItems.get(dirPath)) {
          return true;
        }
        
        // Check all entries in this directory
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        // Check each entry
        for (const entry of entries) {
          const entryPath = path.join(dirPath, entry.name);
          
          // Skip common ignored directories
          if (entry.isDirectory() && (entry.name === 'node_modules' || entry.name === '.git')) {
            continue;
          }
          
          if (entry.isDirectory()) {
            // Recursively check subdirectories
            const hasSelected = await hasSelectedFiles(entryPath);
            if (hasSelected) return true;
          } else {
            // Check if this file is selected
            if (checkedItems.get(entryPath)) {
              return true;
            }
          }
        }
      } catch (error) {
        console.error(`Error checking selected files in ${dirPath}:`, error);
      }
      
      return false;
    };
    
    // Start building the tree from the workspace root
    await buildTree(rootPath);
    
    // Add a separator between workspaces
    result += '\n';
  }
  
  return result;
}

// Utility function to read file content with error handling
async function readFileContent(filePath: string): Promise<string> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return `Error reading file: ${error}`;
  }
}

// Main function to generate the prompt text
export async function generatePrompt(
    selectedFiles: SelectedFile[],
    instructions: string,
    includeOptions: IncludeOptions
): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return 'No workspace folders available.';
    }

    let promptText = '';

    // Process Instructions (Fetch remote content)
    let processedInstructions = instructions;
    if (includeOptions.instructions && instructions) {
        const fetchRegex = /<fetch-instruction name="([^"]+)" url="([^"]+)" \/>/g;
        const fetchPromises: Promise<{ placeholder: string; content: string; name: string }>[] = [];

        let match;
        while ((match = fetchRegex.exec(instructions)) !== null) {
            const placeholder = match[0];
            const name = decodeHtmlEntities(match[1]);
            const url = decodeHtmlEntities(match[2]);

            console.log(`[Generate Prompt] Found fetch instruction for "${name}" at ${url}`);

            fetchPromises.push(
                fetchResourceContent(url)
                    .then(content => ({
                        placeholder,
                        content,
                        name
                    }))
                    .catch(error => {
                        console.error(`Error fetching content for "${name}" from ${url}:`, error);
                        return {
                            placeholder,
                            content: `<!-- Error fetching content for ${name}: ${(error as Error).message} -->`,
                            name
                        };
                    })
            );
        }

        if (fetchPromises.length > 0) {
            try {
                const results = await Promise.all(fetchPromises);
                results.forEach(result => {
                    console.log(`[Generate Prompt] Replacing placeholder for "${result.name}"`);
                    processedInstructions = processedInstructions.replace(result.placeholder, result.content);
                });
            } catch (error) {
                console.error('[Generate Prompt] Error processing fetch instructions:', error);
                processedInstructions += '\n<!-- Error: Failed to process one or more fetch-instructions -->';
            }
        }
    } else {
        processedInstructions = '';
    }

    // Generate File Map (If included)
    if (includeOptions.files) {
        promptText += '<file_map>\n';
        const selectedPaths = selectedFiles.map(f => f.absolutePath);
        promptText += await generateDirectoryTree([...workspaceFolders]);
        promptText += '</file_map>\n\n';
    }
    
    // Add Instructions (If included)
    if (includeOptions.instructions && processedInstructions) {
        promptText += '<instructions>\n';
        promptText += processedInstructions;
        promptText += '\n</instructions>\n\n';
    }

    // Add File Contents (If included)
    if (includeOptions.files) {
        promptText += '<file_contents>\n';
        for (const file of selectedFiles) {
            try {
                const fileContent = file.content ?? await readFileContent(file.absolutePath);

                promptText += `File: ${file.path} (${file.tokenCount} tokens)\n`;
                promptText += '```\n';
                promptText += fileContent;
                promptText += '\n```\n\n';
            } catch (error) {
                console.error(`Error processing file ${file.absolutePath}:`, error);
                promptText += `File: ${file.path}\n<!-- Error processing file: ${(error as Error).message} -->\n\n`;
            }
        }
        promptText += '</file_contents>';
    }

    // Add final newline if needed
    if (!promptText.endsWith('\n')) {
        promptText += '\n';
    }

    return promptText;
}

export async function copyToClipboard(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
} 