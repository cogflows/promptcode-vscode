import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { diffLines } from 'diff';

interface DiffOptions {
  path: string;
  apply?: boolean;
  preview?: boolean;
}

interface CodeBlock {
  filename: string;
  content: string;
  language?: string;
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
      promptData = { codeBlocks: extractCodeBlocks(promptContent) };
    }
    
    const codeBlocks: CodeBlock[] = promptData.codeBlocks || extractCodeBlocks(promptData.response || promptData.content || promptContent);
    
    if (codeBlocks.length === 0) {
      console.log(chalk.yellow('No code blocks found in the prompt file'));
      return;
    }
    
    console.log(chalk.bold(`Found ${codeBlocks.length} code blocks\n`));
    
    for (const block of codeBlocks) {
      if (!block.filename) {
        console.log(chalk.gray('Skipping code block without filename'));
        continue;
      }
      
      const filePath = path.resolve(options.path, block.filename);
      console.log(chalk.bold(`\n--- ${block.filename} ---`));
      
      try {
        const existingContent = await fs.readFile(filePath, 'utf-8');
        const diff = diffLines(existingContent, block.content);
        
        let hasChanges = false;
        diff.forEach((part) => {
          if (part.added || part.removed) {
            hasChanges = true;
            const color = part.added ? chalk.green : chalk.red;
            const prefix = part.added ? '+' : '-';
            console.log(color(part.value.split('\n').filter(line => line).map(line => `${prefix} ${line}`).join('\n')));
          } else if (options.preview) {
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
        
        if (!hasChanges) {
          console.log(chalk.gray('No changes detected'));
        } else if (options.apply) {
          await fs.writeFile(filePath, block.content, 'utf-8');
          console.log(chalk.green('✓ Changes applied'));
        }
        
      } catch (error) {
        if ((error as any).code === 'ENOENT') {
          console.log(chalk.yellow('File does not exist (would be created)'));
          if (options.preview) {
            console.log(chalk.green(block.content.split('\n').map(line => `+ ${line}`).join('\n')));
          }
          if (options.apply) {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, block.content, 'utf-8');
            console.log(chalk.green('✓ File created'));
          }
        } else {
          console.log(chalk.red(`Error: ${(error as Error).message}`));
        }
      }
    }
    
    if (!options.apply && !options.preview) {
      console.log(chalk.gray('\nUse --preview to see full diff or --apply to apply changes'));
    }
    
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const codeBlockRegex = /```(\w+)?\s*(?:\/\/\s*(.+?)|#\s*(.+?)|--\s*(.+?))?\n([\s\S]*?)```/g;
  const fileCommentRegex = /^(?:\/\/|#|--)\s*(.+?)$/m;
  
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1];
    const inlineFilename = match[2] || match[3] || match[4];
    const codeContent = match[5];
    
    // Try to extract filename from first line comment if not in header
    let filename = inlineFilename;
    if (!filename) {
      const fileMatch = fileCommentRegex.exec(codeContent);
      if (fileMatch) {
        filename = fileMatch[1].trim();
      }
    }
    
    if (filename || language) {
      blocks.push({
        filename: filename || '',
        content: codeContent.replace(fileCommentRegex, '').trim(),
        language
      });
    }
  }
  
  return blocks;
}