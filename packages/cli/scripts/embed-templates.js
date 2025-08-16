#!/usr/bin/env node

/**
 * Script to embed template files into the binary during build.
 * This ensures templates are available even after global installation.
 */

const fs = require('fs');
const path = require('path');

function embedTemplates() {
  const claudeTemplatesDir = path.join(__dirname, '..', 'src', 'claude-templates');
  const cursorTemplatesDir = path.join(__dirname, '..', 'src', 'cursor-templates');
  const outputFile = path.join(__dirname, '..', 'src', 'embedded-templates.ts');
  
  console.log('🔨 Embedding templates into binary...');
  
  if (!fs.existsSync(claudeTemplatesDir)) {
    console.error('❌ Claude templates directory not found:', claudeTemplatesDir);
    process.exit(1);
  }
  
  const templates = {};
  
  // Embed Claude templates
  const claudeFiles = fs.readdirSync(claudeTemplatesDir);
  for (const file of claudeFiles) {
    const filePath = path.join(claudeTemplatesDir, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isFile()) {
      const content = fs.readFileSync(filePath, 'utf8');
      templates[file] = content;
      console.log(`  ✓ Embedded Claude: ${file} (${content.length} chars)`);
    }
  }
  
  // Embed Cursor templates if they exist
  if (fs.existsSync(cursorTemplatesDir)) {
    const cursorFiles = fs.readdirSync(cursorTemplatesDir);
    for (const file of cursorFiles) {
      const filePath = path.join(cursorTemplatesDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isFile()) {
        const content = fs.readFileSync(filePath, 'utf8');
        templates[file] = content;
        console.log(`  ✓ Embedded Cursor: ${file} (${content.length} chars)`);
      }
    }
  }
  
  // Generate TypeScript file with embedded templates
  // Use deterministic timestamp in development to avoid git noise
  const timestamp = (process.env.CI || process.env.PROD_BUILD) 
    ? new Date().toISOString()
    : 'development-build';
    
  const tsContent = `/**
 * Embedded templates for compiled binaries.
 * This file is auto-generated during build - DO NOT EDIT MANUALLY.
 * Generated at: ${timestamp}
 */

// Template contents embedded at build time
const EMBEDDED_TEMPLATES: Record<string, string> = ${JSON.stringify(templates, null, 2)};

export function getEmbeddedTemplates(): Record<string, string> {
  return EMBEDDED_TEMPLATES;
}

export function hasEmbeddedTemplates(): boolean {
  return Object.keys(EMBEDDED_TEMPLATES).length > 0;
}
`;
  
  fs.writeFileSync(outputFile, tsContent, 'utf8');
  console.log(`✅ Generated ${outputFile} with ${Object.keys(templates).length} templates`);
}

if (require.main === module) {
  embedTemplates();
}

module.exports = { embedTemplates };