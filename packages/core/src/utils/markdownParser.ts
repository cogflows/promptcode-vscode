/**
 * Markdown parsing utilities for extracting code blocks from AI responses
 */

export interface CodeBlock {
  content: string;
  language?: string;
  filename?: string;
  startLine?: number;
  endLine?: number;
}

export interface ExtractOptions {
  includeLineNumbers?: boolean;
  stripFirstComment?: boolean;
}

/**
 * Extract code blocks from markdown content with support for:
 * - Language detection from ```lang
 * - Filename extraction from header (```ts // filename.ts) or first line comment
 * - Multiple comment styles (// # --)
 * - Line number tracking
 * 
 * @param content - The markdown content to parse
 * @param options - Extraction options
 * @returns Array of code blocks with metadata
 */
export function extractCodeBlocks(content: string, options: ExtractOptions = {}): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const { includeLineNumbers = false, stripFirstComment = true } = options;
  
  // Regex that captures:
  // - Optional language after ```
  // - Optional filename in header after language (with //, #, or -- comment)
  // - Code content
  const codeBlockRegex = /```(\w+)?\s*(?:\/\/\s*(.+?)|#\s*(.+?)|--\s*(.+?))?\n([\s\S]*?)```/g;
  const fileCommentRegex = /^(?:\/\/|#|--)\s*(.+?)$/m;
  
  // Track line numbers if requested
  let currentLine = 1;
  const lines = includeLineNumbers ? content.split('\n') : [];
  
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1];
    const inlineFilename = match[2] || match[3] || match[4];
    let codeContent = match[5];
    
    // Calculate line numbers if requested
    let startLine: number | undefined;
    let endLine: number | undefined;
    
    if (includeLineNumbers) {
      const matchIndex = match.index;
      const beforeMatch = content.substring(0, matchIndex);
      startLine = beforeMatch.split('\n').length + 1; // +1 for the ``` line
      const matchLines = match[0].split('\n').length;
      endLine = startLine + matchLines - 1;
    }
    
    // Try to extract filename from first line comment if not in header
    let filename = inlineFilename;
    if (!filename && codeContent) {
      const fileMatch = fileCommentRegex.exec(codeContent);
      if (fileMatch) {
        filename = fileMatch[1].trim();
        
        // Strip the filename comment if requested
        if (stripFirstComment) {
          codeContent = codeContent.replace(fileCommentRegex, '').trim();
        }
      }
    }
    
    // Only add blocks that have content
    if (codeContent.trim()) {
      const block: CodeBlock = {
        content: codeContent.trim(),
        language,
        filename: filename || undefined,
      };
      
      if (includeLineNumbers) {
        block.startLine = startLine;
        block.endLine = endLine;
      }
      
      blocks.push(block);
    }
  }
  
  return blocks;
}

/**
 * Extract code blocks using line-by-line parsing
 * This method provides more accurate line number tracking
 * 
 * @param content - The markdown content to parse
 * @returns Array of code blocks with precise line numbers
 */
export function extractCodeBlocksByLine(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split('\n');
  
  let inCodeBlock = false;
  let currentBlock: Partial<CodeBlock> | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const codeBlockMatch = line.match(/^```(\w+)?(?:\s+(.+))?$/);
    
    if (codeBlockMatch && !inCodeBlock) {
      // Start of code block
      inCodeBlock = true;
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
        const fileMatch = firstLine.match(/^(?:\/\/|#|--)\s*(.+?)$/);
        if (fileMatch) {
          currentBlock.filename = fileMatch[1].trim();
          // Remove the filename comment from content
          currentBlock.content = currentBlock.content.split('\n').slice(1).join('\n');
        }
      }
      
      // Only add blocks with content
      if (currentBlock.content?.trim()) {
        blocks.push(currentBlock as CodeBlock);
      }
      
      currentBlock = null;
    } else if (inCodeBlock && currentBlock) {
      // Accumulate content
      currentBlock.content = currentBlock.content 
        ? currentBlock.content + '\n' + line 
        : line;
    }
  }
  
  return blocks;
}

/**
 * Simple extraction that only returns content (no metadata)
 * Useful for validation or when metadata isn't needed
 * 
 * @param content - The markdown content to parse
 * @returns Array of code content strings
 */
export function extractCodeContent(content: string): string[] {
  const blocks: string[] = [];
  const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
  
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const codeContent = match[1].trim();
    if (codeContent) {
      blocks.push(codeContent);
    }
  }
  
  return blocks;
}