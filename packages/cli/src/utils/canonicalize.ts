import { createHash } from 'crypto';

/**
 * Canonicalize content to normalize formatting differences
 * This helps detect if a file was actually modified by the user
 * or just has formatting differences (line endings, whitespace, etc.)
 */
export function canonicalizeContent(content: string, fileType?: string): string {
  // Normalize line endings to LF
  let normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // File-type specific canonicalization first (when applicable)
  const ext = (fileType || '').toLowerCase();
  
  if (ext === '.json') {
    try {
      // Parse and re-stringify JSON with sorted keys for consistent ordering
      const obj = JSON.parse(normalized);
      // Sort keys recursively
      const sortKeys = (o: any): any => {
        if (Array.isArray(o)) {
          return o.map(sortKeys);
        } else if (o !== null && typeof o === 'object') {
          return Object.keys(o).sort().reduce((result: any, key) => {
            result[key] = sortKeys(o[key]);
            return result;
          }, {});
        }
        return o;
      };
      const sorted = sortKeys(obj);
      normalized = JSON.stringify(sorted, null, 2) + '\n';
    } catch {
      // If JSON parsing fails, fall through to generic normalization
    }
  } else if (ext === '.md' || ext === '.mdc') {
    // Normalize YAML front-matter if present
    const frontMatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    if (frontMatterMatch) {
      const frontMatter = frontMatterMatch[1];
      const body = normalized.slice(frontMatterMatch[0].length);
      
      // Parse and normalize front-matter
      const frontMatterMap: Record<string, string> = {};
      frontMatter.split('\n').forEach(line => {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (match) {
          frontMatterMap[match[1]] = match[2];
        }
      });
      
      // Rebuild with sorted keys
      const sortedKeys = Object.keys(frontMatterMap).sort();
      const rebuiltFrontMatter = sortedKeys
        .map(key => `${key}: ${frontMatterMap[key]}`)
        .join('\n');
      
      normalized = `---\n${rebuiltFrontMatter}\n---\n${body}`;
    }
  }
  
  // Generic whitespace normalization (applies to all file types)
  normalized = normalized.split('\n')
    .map(line => line.trimEnd())
    .join('\n');
  
  // Remove excessive trailing newlines (keep just one)
  normalized = normalized.trimEnd();
  if (normalized.length > 0) {
    normalized += '\n';
  }
  
  // Remove BOM if present
  if (normalized.charCodeAt(0) === 0xFEFF) {
    normalized = normalized.slice(1);
  }
  
  return normalized;
}

/**
 * Calculate a checksum for canonicalized content
 */
export function calculateChecksum(content: string, fileType?: string): string {
  const canonical = canonicalizeContent(content, fileType);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Check if two file contents are effectively the same after canonicalization
 */
export function areContentsEquivalent(content1: string, content2: string, fileType?: string): boolean {
  return canonicalizeContent(content1, fileType) === canonicalizeContent(content2, fileType);
}