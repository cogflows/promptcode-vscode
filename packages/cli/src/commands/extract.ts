import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Sanitize a filename coming from un-trusted input.
 * – keeps only basename (no folders)  
 * – removes drive letters on Windows  
 * – replaces characters outside the safe set `[A-Za-z0-9._-]`  
 */
function sanitizeFilename(raw: string): string {
  // Remove Windows drive letters (e.g. C:\)
  const withoutDrive = raw.replace(/^[a-zA-Z]:[\\/]/, '');
  const base = path.basename(withoutDrive);
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'untitled';
}

interface ExtractOptions {
  lang?: string;
  saveDir?: string;
  stdout?: boolean;
}

interface CodeBlock {
  content: string;
  language?: string;
  filename?: string;
  startLine: number;
  endLine: number;
}

export async function extractCommand(responseFile: string, options: ExtractOptions) {
  try {
    const content = await fs.readFile(responseFile, 'utf-8');
    const blocks = extractCodeBlocks(content);
    
    if (blocks.length === 0) {
      console.log(chalk.yellow('No code blocks found'));
      return;
    }
    
    // Filter by language if specified
    const filteredBlocks = options.lang 
      ? blocks.filter(b => b.language?.toLowerCase() === options.lang?.toLowerCase())
      : blocks;
    
    if (filteredBlocks.length === 0) {
      console.log(chalk.yellow(`No code blocks found for language: ${options.lang}`));
      return;
    }
    
    console.log(chalk.bold(`Found ${filteredBlocks.length} code blocks\n`));
    
    if (options.stdout) {
      // Output to stdout
      for (const [index, block] of filteredBlocks.entries()) {
        if (filteredBlocks.length > 1) {
          console.log(chalk.gray(`\n--- Block ${index + 1} (${block.language || 'unknown'}) ---`));
        }
        console.log(block.content);
      }
    } else if (options.saveDir) {
      // Save to files
      await fs.mkdir(options.saveDir, { recursive: true });
      
      for (const [index, block] of filteredBlocks.entries()) {
        let filename = block.filename;
        
        if (!filename) {
          // Generate filename
          const ext = getExtensionForLanguage(block.language);
          filename = `extracted_${index + 1}${ext}`;
        }
        
        // ─── security: sanitize & verify ──────────────────────────────
        filename = sanitizeFilename(filename);
        const filePath = path.join(options.saveDir, filename);
        
        // Ensure the resolved path is still inside saveDir (defence-in-depth)
        const resolvedDir = path.resolve(options.saveDir);
        const resolvedFile = path.resolve(filePath);
        if (!resolvedFile.startsWith(resolvedDir + path.sep)) {
          throw new Error(`Invalid filename detected: ${block.filename}`);
        }
        // ──────────────────────────────────────────────────────────────
        
        await fs.writeFile(filePath, block.content, 'utf-8');
        
        console.log(chalk.green(`✓ Saved: ${filename}`));
        console.log(chalk.gray(`  Language: ${block.language || 'unknown'}`));
        console.log(chalk.gray(`  Lines: ${block.content.split('\n').length}`));
      }
    } else {
      // List blocks
      for (const [index, block] of filteredBlocks.entries()) {
        console.log(chalk.bold(`Block ${index + 1}:`));
        console.log(`  Language: ${chalk.cyan(block.language || 'unknown')}`);
        console.log(`  Lines: ${block.content.split('\n').length}`);
        console.log(`  Location: lines ${block.startLine}-${block.endLine}`);
        if (block.filename) {
          console.log(`  Filename: ${chalk.cyan(block.filename)}`);
        }
        console.log(`  Preview: ${chalk.gray(getPreview(block.content))}`);
        console.log();
      }
      
      console.log(chalk.gray('\nUse --stdout to output code or --save-dir to save to files'));
    }
    
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split('\n');
  
  let inCodeBlock = false;
  let currentBlock: Partial<CodeBlock> | null = null;
  let blockStartLine = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const codeBlockMatch = line.match(/^```(\w+)?(?:\s+(.+))?$/);
    
    if (codeBlockMatch && !inCodeBlock) {
      // Start of code block
      inCodeBlock = true;
      blockStartLine = i + 1;
      currentBlock = {
        content: '',
        language: codeBlockMatch[1],
        filename: codeBlockMatch[2],
        startLine: i + 1
      };
    } else if (line.trim() === '```' && inCodeBlock && currentBlock) {
      // End of code block
      inCodeBlock = false;
      currentBlock.endLine = i + 1;
      
      // Check for filename in first line if not in header
      if (!currentBlock.filename && currentBlock.content) {
        const firstLine = currentBlock.content.split('\n')[0];
        const fileMatch = firstLine.match(/^(?:\/\/|#|--|\/\*)\s*(?:file:|filename:)?\s*(.+?)(?:\s*\*\/)?$/);
        if (fileMatch) {
          currentBlock.filename = fileMatch[1].trim();
          // Remove the filename comment from content
          currentBlock.content = currentBlock.content.split('\n').slice(1).join('\n');
        }
      }
      
      if (currentBlock.content!.trim()) {
        blocks.push(currentBlock as CodeBlock);
      }
      currentBlock = null;
    } else if (inCodeBlock && currentBlock) {
      // Inside code block
      if (currentBlock.content) {
        currentBlock.content += '\n';
      }
      currentBlock.content += line;
    }
  }
  
  return blocks;
}

function getExtensionForLanguage(language?: string): string {
  const extensions: Record<string, string> = {
    javascript: '.js',
    typescript: '.ts',
    python: '.py',
    java: '.java',
    cpp: '.cpp',
    c: '.c',
    go: '.go',
    rust: '.rs',
    ruby: '.rb',
    php: '.php',
    swift: '.swift',
    kotlin: '.kt',
    scala: '.scala',
    html: '.html',
    css: '.css',
    json: '.json',
    yaml: '.yaml',
    yml: '.yml',
    xml: '.xml',
    markdown: '.md',
    md: '.md',
    sql: '.sql',
    bash: '.sh',
    shell: '.sh',
    sh: '.sh',
    dockerfile: '.dockerfile',
    makefile: '.makefile'
  };
  
  return extensions[language?.toLowerCase() || ''] || '.txt';
}

function getPreview(content: string, maxLength: number = 60): string {
  const firstLine = content.split('\n')[0].trim();
  if (firstLine.length <= maxLength) {
    return firstLine;
  }
  return firstLine.substring(0, maxLength - 3) + '...';
}