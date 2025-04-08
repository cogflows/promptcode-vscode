import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { checkedItems } from './fileExplorer';
import { countTokensWithCache } from './tokenCounter';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { fetchResourceContent } from './promptcodeDataFetcher';

// --- LOGGING HELPER ---
function log(message: string, data?: any) {
    console.log(`[PromptGenerator] ${message}`, data !== undefined ? data : '');
}
// ----------------------

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

// Helper function to decode HTML entities (might be needed for identifiers)
function decodeHtmlEntities(text: string): string {
    // Decode common entities that might appear in names/urls
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
}

// Helper function to read local file content (assuming it exists)
async function readFileContent(filePath: string): Promise<string> {
    try {
        const fileUri = vscode.Uri.file(filePath);
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        return Buffer.from(fileContent).toString('utf8');
    } catch (error) {
        log(`Error reading file content for ${filePath}`, error);
        throw new Error(`Could not read file: ${filePath}`);
    }
}

// Placeholder for simple token estimation if countTokensWithCache is not suitable
// function estimateTokens(text: string): number {
//     // Simple estimation: words / 0.75 or characters / 4
//     return Math.ceil((text.match(/\\S+/g) || []).length / 0.75);
// }

// New interface for processed resources
interface ProcessedResource {
    name: string; // The name from the tag's 'name' attribute
    content: string;
    tokenCount: number;
    type: 'inline' | 'referenced';
    originalTag: string; // The full original XML tag
}

/**
 * Processes instructions, finds <fetch-instruction> and <embedded-instruction> tags,
 * fetches content, counts tokens, and prepares resources for inclusion.
 */
async function processInstructionsAndResources(
    instructions: string,
    workspaceFolderRootPath: string // Still needed? Maybe not if paths aren't resolved here.
): Promise<{ processedInstructions: string; referencedResources: ProcessedResource[] }> {
    log('Starting instruction processing...');

    // Regex to find <fetch-instruction> and <embedded-instruction> tags
    // Using named capture groups: name, url, content
    const fetchRegex = /<fetch-instruction\s+name="(?<name>[^"]+)"\s+url="(?<url>[^"]+)"\s*\/>/gs;
    const embeddedRegex = /<embedded-instruction\s+name="(?<name>[^"]+)">\s*(?<content>[\s\S]*?)\s*<\/embedded-instruction>/gs;

    const promises: Promise<ProcessedResource | null>[] = [];
    const foundTags = new Map<string, string>(); // Store original tag string by unique name identifier

    // --- Process Fetch Instructions ---
    let fetchMatch;
    while ((fetchMatch = fetchRegex.exec(instructions)) !== null) {
        const originalTag = fetchMatch[0];
        const name = decodeHtmlEntities(fetchMatch.groups?.name || '');
        const url = decodeHtmlEntities(fetchMatch.groups?.url || '');

        if (!name || !url) {
            log('Skipping invalid fetch tag (missing name or url)', { originalTag });
            continue;
        }
        
        // Only process the first occurrence for fetching, but store the tag for later replacement
        if (!foundTags.has(name)) { 
             foundTags.set(name, originalTag); // Store the first tag found for this name
             log(`Found fetch instruction tag for: ${name}`, { url });
             promises.push((async (): Promise<ProcessedResource | null> => {
                try {
                    const content = await fetchResourceContent(url);
                    log(`Fetched content for ${name} (URL)`, { length: content.length });
                    const tokenCount = countTokens(content);
                    log(`Token count for ${name} (URL): ${tokenCount}`);
                    return {
                        name,
                        content,
                        tokenCount,
                        type: tokenCount < 1000 ? 'inline' : 'referenced',
                        originalTag // Store the specific tag instance we used for fetching
                    };
                } catch (error) {
                    log(`Error fetching content for "${name}" from ${url}`, error);
                    return {
                        name,
                        content: `<!-- Error fetching resource ${name}: ${(error as Error).message} -->`,
                        tokenCount: 0,
                        type: 'inline',
                        originalTag
                    };
                }
            })());
        } else {
             log(`Skipping duplicate fetch instruction tag processing for: ${name}`);
        }
    }

    // --- Process Embedded Instructions ---
    let embeddedMatch;
    while ((embeddedMatch = embeddedRegex.exec(instructions)) !== null) {
        const originalTag = embeddedMatch[0];
        const name = decodeHtmlEntities(embeddedMatch.groups?.name || '');
        const content = embeddedMatch.groups?.content || ''; // Content is directly in the tag

        if (!name) {
            log('Skipping invalid embedded tag (missing name)', { originalTag });
            continue;
        }

        // Only process the first occurrence, but store the tag for later replacement
        if (!foundTags.has(name)) { 
            foundTags.set(name, originalTag); // Store the first tag found for this name
            log(`Found embedded instruction tag for: ${name}`, { contentLength: content.length });
            promises.push((async (): Promise<ProcessedResource | null> => {
                try {
                    // Content is already available
                    const tokenCount = countTokens(content);
                    log(`Token count for ${name} (Embedded): ${tokenCount}`);
                    return {
                        name,
                        content,
                        tokenCount,
                        type: tokenCount < 1000 ? 'inline' : 'referenced',
                        originalTag
                    };
                } catch (error) {
                    // Should be rare for embedded content unless token counter fails
                    log(`Error processing embedded content for "${name}"`, error);
                    return {
                        name,
                        content: `<!-- Error processing resource ${name}: ${(error as Error).message} -->`,
                        tokenCount: 0,
                        type: 'inline',
                        originalTag
                    };
                }
            })());
        } else {
             log(`Skipping duplicate embedded instruction tag processing for: ${name}`);
        }
    }

    log(`Awaiting ${promises.length} resource processing promises...`);
    const results = await Promise.all(promises);
    const validResults = results.filter(r => r !== null) as ProcessedResource[];
    log(`Processed ${validResults.length} unique resources.`);

    let processedInstructions = instructions;
    const referencedResources: ProcessedResource[] = [];

    // --- Replace Tags ---
    // Iterate through the *unique processed results* and replace *all* occurrences
    // of the corresponding original tag structure in the instruction string.
    for (const result of validResults) {
        log(`Processing replacement for: ${result.name} (Type: ${result.type})`);
        const tagToReplace = result.originalTag; // The specific tag structure (fetch or embedded) we processed
        
        // Need a robust way to replace all occurrences of the specific tag structure.
        // Simple string replace might be okay if tags are unique enough, but regex is safer.
        // Create a regex to match the specific original tag literally.
        const escapedTagRegex = new RegExp(tagToReplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

        if (result.type === 'inline') {
            const inlineContent = `<inline_resource source="${result.name}">\n${result.content}\n</inline_resource>`;
            processedInstructions = processedInstructions.replace(escapedTagRegex, inlineContent);
            log(`Replaced tag for ${result.name} with inline content.`);
        } else {
            const resourceTag = `<resource label="${result.name}">`;
            processedInstructions = processedInstructions.replace(escapedTagRegex, resourceTag);
            referencedResources.push(result); // Add to list for the final <resources> block
            log(`Replaced tag for ${result.name} with resource placeholder.`);
        }
    }

    // Sort referenced resources by token count (ascending)
    referencedResources.sort((a, b) => a.tokenCount - b.tokenCount);
    log(`Sorted ${referencedResources.length} referenced resources.`);

    log('Finished instruction processing.');
    return { processedInstructions, referencedResources };
}


/**
 * Generates the final prompt string based on selected files, instructions, and options.
 */
export async function generatePrompt(
    selectedFiles: SelectedFile[],
    instructions: string,
    includeOptions: IncludeOptions
): Promise<string> {
    log('--- Starting generatePrompt ---');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        log('No workspace folders found. Aborting prompt generation.');
        return 'No workspace folders available.';
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    log('Workspace root:', { workspaceRoot });

    let finalPromptText = '';
    let processedInstructions = '';
    let resourcesBlock = '';

    // 1. Process Instructions and Resources
    if (includeOptions.instructions && instructions) {
        log('Processing instructions and resources...');
        try {
            const { 
                processedInstructions: modifiedInstructions, 
                referencedResources 
            } = await processInstructionsAndResources(instructions, workspaceRoot);
            
            processedInstructions = modifiedInstructions;
            log('Instructions processed successfully.');

            // Build the resources block if needed
            if (referencedResources.length > 0) {
                log(`Building resources block for ${referencedResources.length} resources.`);
                resourcesBlock += '<resources>\n';
                for (const resource of referencedResources) {
                    resourcesBlock += `  <resource label="${resource.name}">\n`;
                    // Indent content for readability
                    resourcesBlock += resource.content.split('\n').map(line => `    ${line}`).join('\n');
                    resourcesBlock += '\n  </resource>\n';
                }
                resourcesBlock += '</resources>\n';
                log('Finished building resources block.');
            } else {
                 log('No referenced resources to build block for.');
            }

        } catch (error) {
            log('Error processing instructions and resources:', error);
            processedInstructions = instructions + '\n<!-- Error: Failed to process instructions and resources -->';
        }
    } else {
        log('Instructions not included or empty.');
        processedInstructions = instructions; // Keep original if not processed
    }

    // 2. Add Instructions (Processed)
    if (includeOptions.instructions && processedInstructions) {
        log('Adding processed instructions to prompt.');
        finalPromptText += '<instructions>\n';
        finalPromptText += processedInstructions;
        finalPromptText += '\n</instructions>\n\n';
    }

    // 3. Generate File Map (If included)
    if (includeOptions.files) {
        log('Generating file map...');
        if (typeof generateDirectoryTree === 'function') { 
            try {
                 finalPromptText += '<file_map>\n';
                 finalPromptText += await generateDirectoryTree([...workspaceFolders]); 
                 finalPromptText += '</file_map>\n\n';
                 log('File map generated.');
            } catch (error) {
                 log('Error generating file map:', error);
                 finalPromptText += '<file_map>\n<!-- Error generating file map -->\n</file_map>\n\n';
            }
        } else {
             log('generateDirectoryTree function not found. Skipping file map.');
             finalPromptText += '<file_map>\n<!-- File map generation unavailable -->\n</file_map>\n\n';
        }
    } else {
         log('File map not included.');
    }

    // 4. Add File Contents (If included)
    if (includeOptions.files) {
        log(`Adding content for ${selectedFiles.length} selected files...`);
        finalPromptText += '<file_contents>\n';
        for (const file of selectedFiles) {
            try {
                const fileContent = file.content ?? await readFileContent(file.absolutePath);
                finalPromptText += `File: ${file.path} (${file.tokenCount} tokens)\n`; 
                finalPromptText += '```\n';
                finalPromptText += fileContent;
                finalPromptText += '\n```\n\n';
            } catch (error) {
                log(`Error adding file content for ${file.path}:`, error);
                finalPromptText += `File: ${file.path}\n<!-- Error reading file content: ${(error as Error).message} -->\n\n`;
            }
        }
        finalPromptText += '</file_contents>\n\n'; 
        log('Finished adding file contents.');
    } else {
        log('File contents not included.');
    }

    // 5. Add Resources Block (If generated)
    if (resourcesBlock) {
        log('Adding resources block to prompt.');
        finalPromptText += resourcesBlock;
    }

    // Ensure final newline
    if (finalPromptText && !finalPromptText.endsWith('\n')) {
        finalPromptText += '\n';
    }
    
    log('--- Finished generatePrompt ---');
    return finalPromptText;
}

// Generate a directory tree representation for the prompt
export async function generateDirectoryTree(workspaceFolders: vscode.WorkspaceFolder[]): Promise<string> {
  let result = '';

  for (const folder of workspaceFolders) {
    const rootPath = folder.uri.fsPath;
    const rootName = folder.name;

    result += `# Workspace: ${rootName}\n`;

    // Helper function to check if a directory or its children contain selected files
    const hasSelectedFiles = async (dirPath: string): Promise<boolean> => {
      // Use a Set for efficient checking of checked items
      const checkedPathsSet = new Set(Array.from(checkedItems.keys()));

      // Recursive helper function
      const checkRecursively = async (currentPath: string): Promise<boolean> => {
        // Check if the current path itself is selected
        if (checkedPathsSet.has(currentPath)) {
          return true;
        }

        try {
          const stats = await fs.promises.stat(currentPath);
          if (!stats.isDirectory()) {
            return false; // Not a directory, cannot contain selected children
          }

          const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

          for (const entry of entries) {
            // Skip common ignored directories/files
            if (entry.name === 'node_modules' || entry.name === '.git') {
              continue;
            }

            const entryPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
              // Recursively check subdirectories
              if (await checkRecursively(entryPath)) {
                return true;
              }
            } else {
              // Check if this file is selected
              if (checkedPathsSet.has(entryPath)) {
                return true;
              }
            }
          }
        } catch (error) {
          // Log error but continue checking other paths
          log(`Error checking selected files in ${currentPath}`, error);
        }
        return false;
      };

      return await checkRecursively(dirPath);
    };

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

          // Skip common ignored directories/files
          if (entry.name === 'node_modules' || entry.name === '.git') {
            continue;
          }

          // Check if this entry is the last one at this level
          const isLast = i === sortedEntries.length - 1;

          // Determine the branch character
          const branchChar = isLast ? '└──' : '├──';

          // Determine the prefix for the next level
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');

          if (entry.isDirectory()) {
            // Check if this directory or its children contain any selected files before including it
            // Also ensure the directory itself should be processed (not explicitly ignored)
            if (await hasSelectedFiles(entryPath)) {
              // Add directory entry
              result += `${prefix}${branchChar} ${entry.name}/\n`;
              // Recursively process subdirectory
              await buildTree(entryPath, nextPrefix);
            }
          } else {
            // Check if this file is selected
            if (checkedItems.get(entryPath)) {
                // Get the relative path from the specific workspace root for display
                const relativePath = path.relative(rootPath, entryPath);
                // Add file entry
                result += `${prefix}${branchChar} ${entry.name} (${relativePath})\n`;
            }
          }
        }
      } catch (error) {
        log(`Error building tree for ${dirPath}`, error);
      }
    };

    // Start building the tree from the workspace root
    await buildTree(rootPath);

    // Add a separator between workspaces
    result += '\n';
  }

  return result.trimEnd(); // Trim trailing newline from the last workspace
}

export async function copyToClipboard(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  log('Prompt copied to clipboard.');
} 