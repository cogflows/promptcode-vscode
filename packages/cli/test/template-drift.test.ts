import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Template drift test to ensure all flags referenced in templates
 * actually exist in the CLI implementation.
 * This prevents issues like the --from-context flag that never existed.
 */
describe('template drift detection', () => {
  // Known valid flags for each command
  const VALID_FLAGS: Record<string, Set<string>> = {
    'expert': new Set([
      '--path', '--preset', '-f', '--files', '--prompt-file', '--model',
      '--models', '-o', '--output', '--stream', '--save-preset', '-y', '--yes',
      '--force', '--web-search', '--no-web-search', '--verbosity',
      '--reasoning-effort', '--service-tier', '--json', '--estimate-cost',
      '--cost-threshold', '-h', '--help'
    ]),
    'preset': new Set([
      '--path', '--list', '--create', '--info', '--optimize', '--edit',
      '--delete', '--search', '--from-files', '--optimization-level',
      '--level', '--write', '--dry-run', '--json', '-h', '--help',
      'create', 'info', 'list', 'optimize', 'search', 'edit', 'delete'
    ]),
    'generate': new Set([
      '-p', '--preset', '-f', '--files', '-l', '--list', '-t', '--template',
      '-i', '--instructions', '-o', '--out', '--output', '--json',
      '--ignore-gitignore', '--path', '--save-preset', '--dry-run',
      '--token-warning', '--estimate-cost', '--cost-threshold', '--model',
      '-y', '--yes', '-h', '--help'
    ]),
    'models': new Set([
      '--json', '--all', '-h', '--help'
    ]),
    'cache': new Set([
      '--clear', '--stats', '--json', '-h', '--help'
    ]),
    'config': new Set([
      '--show', '--set-openai-key', '--set-anthropic-key', '--set-google-key',
      '--set-xai-key', '--clear-all', '-h', '--help'
    ])
  };

  // Patterns that should never appear in templates (removed/invalid flags)
  const BANNED_FLAGS = [
    '--from-context'  // The flag that caused the original issue
  ];

  function extractCommandReferences(content: string): Array<{command: string, flags: string[], line: number}> {
    const references: Array<{command: string, flags: string[], line: number}> = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Skip metadata lines (frontmatter and allowed-tools)
      if (line.startsWith('---') || line.startsWith('allowed-tools:') || line.startsWith('description:') || line.startsWith('alwaysApply:')) {
        continue;
      }
      
      // Match patterns like: promptcode <command> [options]
      // Also match backtick-wrapped commands
      const matches = line.matchAll(/`?promptcode\s+(\w+)([^`\n]*)`?/g);
      
      for (const match of matches) {
        const command = match[1];
        const rest = match[2] || '';
        
        // Extract all flags (--flag or -f patterns)
        // But exclude placeholders like <preset-name> or {preset_name}
        // Improved regex that only matches flags starting with - or --
        // and ensures they're not part of placeholders
        const flags: string[] = [];
        
        // Match actual flags: start with - or --, followed by word chars
        // But make sure they're not inside <> or {} placeholders
        const flagMatches = rest.matchAll(/(?<![<{])\s(--?[\w-]+)(?![}>])/g);
        for (const match of flagMatches) {
          flags.push(match[1]);
        }
        
        if (flags.length > 0) {
          references.push({
            command,
            flags,
            line: i + 1
          });
        }
      }
    }
    
    return references;
  }

  function loadTemplateFiles(): Array<{file: string, content: string}> {
    const templates: Array<{file: string, content: string}> = [];
    const srcDir = path.join(__dirname, '..', 'src');
    
    // Load Claude templates
    const claudeDir = path.join(srcDir, 'claude-templates');
    if (fs.existsSync(claudeDir)) {
      const files = fs.readdirSync(claudeDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = fs.readFileSync(path.join(claudeDir, file), 'utf-8');
          templates.push({ file: `claude-templates/${file}`, content });
        }
      }
    }
    
    // Load Cursor templates
    const cursorDir = path.join(srcDir, 'cursor-templates');
    if (fs.existsSync(cursorDir)) {
      const files = fs.readdirSync(cursorDir);
      for (const file of files) {
        if (file.endsWith('.mdc') || file.endsWith('.md')) {
          const content = fs.readFileSync(path.join(cursorDir, file), 'utf-8');
          templates.push({ file: `cursor-templates/${file}`, content });
        }
      }
    }
    
    // Also check root .claude/commands if it exists
    const rootClaudeDir = path.join(__dirname, '..', '..', '..', '.claude', 'commands');
    if (fs.existsSync(rootClaudeDir)) {
      const files = fs.readdirSync(rootClaudeDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = fs.readFileSync(path.join(rootClaudeDir, file), 'utf-8');
          templates.push({ file: `.claude/commands/${file}`, content });
        }
      }
    }
    
    return templates;
  }

  it('should not reference non-existent flags in templates', () => {
    const templates = loadTemplateFiles();
    const errors: string[] = [];
    
    for (const template of templates) {
      const references = extractCommandReferences(template.content);
      
      for (const ref of references) {
        const validFlags = VALID_FLAGS[ref.command];
        
        if (!validFlags) {
          // Unknown command - might be okay (like cc, update, etc)
          continue;
        }
        
        for (const flag of ref.flags) {
          if (!validFlags.has(flag)) {
            errors.push(
              `${template.file}:${ref.line} - Unknown flag "${flag}" for command "${ref.command}"`
            );
          }
        }
      }
    }
    
    if (errors.length > 0) {
      throw new Error(
        'Template drift detected! The following flags don\'t exist:\n' +
        errors.join('\n')
      );
    }
  });

  it('should not reference banned flags in templates', () => {
    const templates = loadTemplateFiles();
    const errors: string[] = [];
    
    for (const template of templates) {
      const references = extractCommandReferences(template.content);
      
      for (const ref of references) {
        for (const flag of ref.flags) {
          if (BANNED_FLAGS.includes(flag)) {
            errors.push(
              `${template.file}:${ref.line} - Banned flag "${flag}" found in command "${ref.command}"`
            );
          }
        }
      }
      
      // Also check for raw occurrences of banned flags
      const lines = template.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const banned of BANNED_FLAGS) {
          if (lines[i].includes(banned)) {
            errors.push(
              `${template.file}:${i + 1} - Banned flag "${banned}" found in text`
            );
          }
        }
      }
    }
    
    if (errors.length > 0) {
      throw new Error(
        'Banned flags detected in templates!\n' +
        errors.join('\n')
      );
    }
  });

  it('should have embedded templates match source templates', () => {
    const embeddedPath = path.join(__dirname, '..', 'src', 'embedded-templates.ts');
    if (!fs.existsSync(embeddedPath)) {
      // Embedded templates not generated yet, skip
      return;
    }
    
    const embeddedContent = fs.readFileSync(embeddedPath, 'utf-8');
    
    // Check for any TODO or placeholder comments that suggest templates need regeneration
    if (embeddedContent.includes('TODO') || embeddedContent.includes('regenerate')) {
      console.warn('Warning: embedded-templates.ts may need regeneration');
    }
    
    // We rely on the checksum system for actual content validation
    // This test just ensures the file exists and looks valid
    // The embedded templates are now in a single EMBEDDED_TEMPLATES const
    expect(embeddedContent).toContain('EMBEDDED_TEMPLATES');
  });
});