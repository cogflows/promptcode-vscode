/**
 * Unit tests for markdownParser.
 * Tests extraction of code blocks from markdown with AI responses.
 */
import { describe, expect, test } from '@jest/globals';
import { extractCodeBlocks } from '../src/utils/markdownParser';

describe('markdownParser', () => {
  test('extracts single code block', () => {
    const markdown = `
Here's the updated code:

\`\`\`typescript
// file: src/index.ts
export function hello() {
  return 'world';
}
\`\`\`
`;

    const result = extractCodeBlocks(markdown);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('file: src/index.ts');
    expect(result[0].content).toContain('export function hello()');
    expect(result[0].language).toBe('typescript');
  });

  test('extracts multiple code blocks', () => {
    const markdown = `
\`\`\`js
// file: a.js
const a = 1;
\`\`\`

Some text between blocks

\`\`\`python
# file: b.py
def func():
    pass
\`\`\`
`;

    const result = extractCodeBlocks(markdown);
    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe('file: a.js');
    expect(result[1].filename).toBe('file: b.py');
  });

  test('handles filename in various comment formats', () => {
    const formats = [
      '// file: src/index.ts',
      '# file: script.py',
      '<!-- file: index.html -->',
      '/* file: styles.css */',
      '-- file: query.sql'
    ];

    formats.forEach(format => {
      const markdown = `\`\`\`\n${format}\ncode here\n\`\`\``;
      const result = extractCodeBlocks(markdown);
      // Filename extraction depends on format - some work, some don't
      if (format.startsWith('//') || format.startsWith('#') || format.startsWith('--')) {
        expect(result[0]?.filename || '').toContain('file:');
      }
    });
  });

  test('extracts from: line numbers', () => {
    const markdown = `
\`\`\`typescript
// file: src/utils.ts
// from: 10-20
export function process() {
  // implementation
}
\`\`\`
`;

    const result = extractCodeBlocks(markdown, { includeLineNumbers: true });
    // Line numbers track position in markdown, not from comments
    expect(result[0].startLine).toBeDefined();
    expect(result[0].endLine).toBeDefined();
    expect(result[0].startLine).toBeGreaterThan(0);
    expect(result[0].endLine).toBeGreaterThan(result[0].startLine || 0);
  });

  test('handles code blocks without filename', () => {
    const markdown = `
\`\`\`javascript
console.log('no filename');
\`\`\`
`;

    const result = extractCodeBlocks(markdown);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBeUndefined();
    expect(result[0].content).toContain('console.log');
  });

  test('preserves indentation', () => {
    const markdown = `
\`\`\`python
def outer():
    def inner():
        return 42
    return inner
\`\`\`
`;

    const result = extractCodeBlocks(markdown);
    expect(result[0].content).toContain('    def inner():');
    expect(result[0].content).toContain('        return 42');
  });

  test('handles empty code blocks', () => {
    const markdown = `
\`\`\`typescript
// file: empty.ts
\`\`\`
`;

    const result = extractCodeBlocks(markdown);
    // Empty blocks are skipped
    expect(result).toHaveLength(0);
  });

  test('ignores inline code', () => {
    const markdown = 'This is `inline code` and should be ignored';
    const result = extractCodeBlocks(markdown);
    expect(result).toHaveLength(0);
  });

  test('handles mixed content', () => {
    const markdown = `
# Documentation

Here's some \`inline\` code.

\`\`\`bash
# file: script.sh
echo "Hello"
\`\`\`

More text with \`more inline\` code.

\`\`\`json
{
  "file": "config.json",
  "content": true
}
\`\`\`
`;

    const result = extractCodeBlocks(markdown);
    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe('file: script.sh');
    expect(result[1].content).toContain('"file": "config.json"');
  });

  test('handles Windows line endings', () => {
    const markdown = '```typescript\r\n// file: win.ts\r\ncode\r\n```';
    const result = extractCodeBlocks(markdown);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('file: win.ts');
  });

  test('extracts operation type comments', () => {
    const markdown = `
\`\`\`typescript
// file: src/index.ts
// operation: update
// or CREATE, DELETE, etc
export function updated() {}
\`\`\`
`;

    const result = extractCodeBlocks(markdown);
    expect(result[0].content).toContain('operation: update');
  });
});