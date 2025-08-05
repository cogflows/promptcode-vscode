import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { diffLines } from 'diff';
import { extractCodeBlocks, type CodeBlock } from '@promptcode/core';

interface DiffOptions {
  path: string;
  apply?: boolean;
  preview?: boolean;
  json?: boolean;
}


interface DiffResult {
  filePath: string;
  status: 'modified' | 'added' | 'unchanged' | 'error';
  diff?: string;
  content?: string;
  error?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export async function diffCommand(promptFile: string, options: DiffOptions) {
  try {
    // Read the prompt file
    const promptContent = await fs.readFile(promptFile, 'utf-8');
    let promptData: any;
    
    try {
      promptData = JSON.parse(promptContent);
    } catch {
      // If not JSON, try to extract code blocks from markdown
      promptData = { codeBlocks: extractCodeBlocks(promptContent).filter(b => b.filename) };
    }
    
    const codeBlocks: CodeBlock[] = promptData.codeBlocks || extractCodeBlocks(promptData.response || promptData.content || promptContent).filter(b => b.filename);
    
    if (codeBlocks.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'No code blocks found in the prompt file' }, null, 2));
      } else {
        console.log(chalk.yellow('No code blocks found in the prompt file'));
      }
      return;
    }
    
    if (!options.json) {
      console.log(chalk.bold(`Found ${codeBlocks.length} code blocks\n`));
    }
    
    const results: DiffResult[] = [];
    
    for (const block of codeBlocks) {
      if (!block.filename) {
        if (!options.json) {
          console.log(chalk.gray('Skipping code block without filename'));
        }
        continue;
      }
      
      const filePath = path.resolve(options.path, block.filename);
      
      // Security check: ensure path is within project root
      const projectRoot = path.resolve(options.path) + path.sep;
      if (!filePath.startsWith(projectRoot)) {
        const error = `Path traversal attempt blocked: ${block.filename}`;
        if (options.json) {
          results.push({
            filePath: block.filename!,
            status: 'error',
            error
          });
          continue;
        } else {
          console.error(chalk.red(`Error: ${error}`));
          continue;
        }
      }
      
      if (!options.json) {
        console.log(chalk.bold(`\n--- ${block.filename} ---`));
      }
      
      const result: DiffResult = {
        filePath: block.filename!,
        status: 'unchanged'
      };
      
      try {
        const existingContent = await fs.readFile(filePath, 'utf-8');
        const diff = diffLines(existingContent, block.content);
        
        let hasChanges = false;
        let linesAdded = 0;
        let linesRemoved = 0;
        let diffString = '';
        
        diff.forEach((part) => {
          if (part.added || part.removed) {
            hasChanges = true;
            const lines = part.value.split('\n').filter(line => line);
            
            if (part.added) {
              linesAdded += lines.length;
              lines.forEach(line => {
                diffString += `+ ${line}\n`;
                if (!options.json) {
                  console.log(chalk.green(`+ ${line}`));
                }
              });
            } else {
              linesRemoved += lines.length;
              lines.forEach(line => {
                diffString += `- ${line}\n`;
                if (!options.json) {
                  console.log(chalk.red(`- ${line}`));
                }
              });
            }
          } else if (options.preview && !options.json) {
            // Show context lines in preview mode
            const lines = part.value.split('\n').filter(line => line);
            if (lines.length <= 6) {
              console.log(chalk.gray(lines.map(line => `  ${line}`).join('\n')));
            } else {
              console.log(chalk.gray(`  ${lines[0]}`));
              console.log(chalk.gray(`  ${lines[1]}`));
              console.log(chalk.gray(`  ... (${lines.length - 4} lines) ...`));
              console.log(chalk.gray(`  ${lines[lines.length - 2]}`));
              console.log(chalk.gray(`  ${lines[lines.length - 1]}`));
            }
          }
        });
        
        if (hasChanges) {
          result.status = 'modified';
          result.linesAdded = linesAdded;
          result.linesRemoved = linesRemoved;
          result.diff = diffString.trim();
        }
        
        if (!hasChanges && !options.json) {
          console.log(chalk.gray('No changes detected'));
        } else if (hasChanges && options.apply) {
          await fs.writeFile(filePath, block.content, 'utf-8');
          if (!options.json) {
            console.log(chalk.green('✓ Changes applied'));
          }
        }
        
      } catch (error) {
        if ((error as any).code === 'ENOENT') {
          result.status = 'added';
          result.content = block.content;
          
          if (!options.json) {
            console.log(chalk.yellow('File does not exist (would be created)'));
            if (options.preview) {
              console.log(chalk.green(block.content.split('\n').map(line => `+ ${line}`).join('\n')));
            }
          }
          
          if (options.apply) {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, block.content, 'utf-8');
            if (!options.json) {
              console.log(chalk.green('✓ File created'));
            }
          }
        } else {
          result.status = 'error';
          result.error = (error as Error).message;
          if (!options.json) {
            console.log(chalk.red(`Error: ${(error as Error).message}`));
          }
        }
      }
      
      results.push(result);
    }
    
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else if (!options.apply && !options.preview) {
      console.log(chalk.gray('\nUse --preview to see full diff or --apply to apply changes'));
    }
    
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: (error as Error).message }, null, 2));
    } else {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    }
    process.exit(1);
  }
}

