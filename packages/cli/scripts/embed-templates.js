#!/usr/bin/env node

/**
 * Script to embed template files into the binary during build.
 * This ensures templates are available even after global installation.
 */

const fs = require('fs');
const path = require('path');

function embedTemplates() {
  const templatesDir = path.join(__dirname, '..', 'src', 'claude-templates');
  const outputFile = path.join(__dirname, '..', 'src', 'embedded-templates.ts');
  
  console.log('🔨 Embedding templates into binary...');
  
  if (!fs.existsSync(templatesDir)) {
    console.error('❌ Templates directory not found:', templatesDir);
    process.exit(1);
  }
  
  const templates = {};
  const files = fs.readdirSync(templatesDir);
  
  for (const file of files) {
    const filePath = path.join(templatesDir, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isFile()) {
      const content = fs.readFileSync(filePath, 'utf8');
      templates[file] = content;
      console.log(`  ✓ Embedded ${file} (${content.length} chars)`);
    }
  }
  
  // Generate TypeScript file with embedded templates
  const tsContent = `/**
 * Embedded templates for compiled binaries.
 * This file is auto-generated during build - DO NOT EDIT MANUALLY.
 * Generated at: ${new Date().toISOString()}
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