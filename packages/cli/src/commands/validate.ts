import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ValidateOptions {
  rules?: string;
  fix?: boolean;
}

interface ValidationRule {
  name: string;
  pattern: RegExp;
  message: string;
  severity: 'error' | 'warning';
  fix?: (content: string) => string;
}

/**
 * Allowed declarative fix operations.
 */
type FixSpec =
  | { type: 'replace'; with: string }
  | { type: 'remove' }
  | { type: 'prepend'; text: string }
  | { type: 'append'; text: string };

const DEFAULT_RULES: ValidationRule[] = [
  {
    name: 'no-console-log',
    pattern: /console\.log\(/g,
    message: 'Avoid console.log in production code',
    severity: 'warning',
    fix: (content) => content.replace(/console\.log\(/g, '// console.log(')
  },
  {
    name: 'no-debugger',
    pattern: /\bdebugger\b/g,
    message: 'Remove debugger statements',
    severity: 'error',
    fix: (content) => content.replace(/\bdebugger\b\s*;?/g, '')
  },
  {
    name: 'no-todo',
    pattern: /\/\/\s*TODO:/gi,
    message: 'TODO comments found',
    severity: 'warning'
  },
  {
    name: 'no-api-keys',
    pattern: /(?:api[_-]?key|apikey|api[_-]?secret|access[_-]?token)\s*[:=]\s*["'][^"']+["']/gi,
    message: 'Potential API key or secret found',
    severity: 'error'
  },
  {
    name: 'no-private-keys',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
    message: 'Private key detected',
    severity: 'error'
  }
];

export async function validateCommand(file: string, options: ValidateOptions) {
  try {
    const content = await fs.readFile(file, 'utf-8');
    
    // Load custom rules if provided
    let rules = DEFAULT_RULES;
    if (options.rules) {
      try {
        const customRulesContent = await fs.readFile(options.rules, 'utf-8');
        const customRules = JSON.parse(customRulesContent);
        rules = [...rules, ...customRules.map(parseCustomRule)];
      } catch (error) {
        console.error(chalk.yellow(`Warning: Could not load custom rules: ${(error as Error).message}`));
      }
    }
    
    // Extract code blocks if the file appears to be an AI response
    const codeBlocks = extractCodeBlocks(content);
    const contentToValidate = codeBlocks.length > 0 
      ? codeBlocks.map(b => b.content).join('\n\n')
      : content;
    
    // Run validation
    const issues: Array<{rule: ValidationRule; matches: RegExpMatchArray[]}> = [];
    let fixedContent = contentToValidate;
    
    for (const rule of rules) {
      const matches = Array.from(contentToValidate.matchAll(rule.pattern));
      if (matches.length > 0) {
        issues.push({ rule, matches });
        
        if (options.fix && rule.fix) {
          fixedContent = rule.fix(fixedContent);
        }
      }
    }
    
    // Report results
    if (issues.length === 0) {
      console.log(chalk.green('✓ No issues found'));
      return;
    }
    
    console.log(chalk.bold(`Found ${issues.length} validation issues:\n`));
    
    let errors = 0;
    let warnings = 0;
    
    for (const { rule, matches } of issues) {
      const icon = rule.severity === 'error' ? '❌' : '⚠️';
      const color = rule.severity === 'error' ? chalk.red : chalk.yellow;
      
      console.log(`${icon} ${color(rule.name)}: ${rule.message}`);
      console.log(chalk.gray(`   Found ${matches.length} occurrence(s)`));
      
      if (rule.severity === 'error') errors += matches.length;
      else warnings += matches.length;
      
      // Show first few matches
      const showMatches = matches.slice(0, 3);
      for (const match of showMatches) {
        const line = getLineNumber(contentToValidate, match.index!);
        console.log(chalk.gray(`   Line ${line}: ${match[0].substring(0, 60)}...`));
      }
      
      if (matches.length > 3) {
        console.log(chalk.gray(`   ... and ${matches.length - 3} more`));
      }
      console.log();
    }
    
    // Summary
    console.log(chalk.bold('Summary:'));
    if (errors > 0) console.log(chalk.red(`  ${errors} error(s)`));
    if (warnings > 0) console.log(chalk.yellow(`  ${warnings} warning(s)`));
    
    // Apply fixes if requested
    if (options.fix && fixedContent !== contentToValidate) {
      const outputFile = file.replace(/\.(txt|md)$/, '.fixed$1');
      await fs.writeFile(outputFile, fixedContent, 'utf-8');
      console.log(chalk.green(`\n✓ Fixed content written to: ${outputFile}`));
    }
    
    // Exit with error code if errors found
    if (errors > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

function buildFixFunction(
  regex: RegExp,
  spec: FixSpec
): (content: string) => string {
  switch (spec.type) {
    case 'replace':
      return (content) => content.replace(regex, spec.with);
    case 'remove':
      return (content) => content.replace(regex, '');
    case 'prepend':
      return (content) => spec.text + content;
    case 'append':
      return (content) => content + spec.text;
    /* istanbul ignore next */
    default:
      // Should never happen thanks to type system
      return (c) => c;
  }
}

function parseCustomRule(rule: any): ValidationRule {
  // Basic validation – keep runtime safe even if JSON is malformed
  if (typeof rule.name !== 'string' || typeof rule.pattern !== 'string') {
    throw new Error('Custom rule must have "name" and "pattern" fields');
  }

  const regex = new RegExp(rule.pattern, rule.flags || 'g');

  let fixFn: ((content: string) => string) | undefined;

  if (rule.fix) {
    // Whitelist approach – only the fields we expect.
    const allowed = ['type', 'with', 'text'];
    const unknownKeys = Object.keys(rule.fix).filter((k) => !allowed.includes(k));
    if (unknownKeys.length) {
      throw new Error(
        `Unknown keys in fix spec: ${unknownKeys.join(', ')}`
      );
    }

    fixFn = buildFixFunction(regex, rule.fix as FixSpec);
  }

  return {
    name: rule.name,
    pattern: regex,
    message: rule.message ?? '',
    severity: rule.severity === 'error' ? 'error' : 'warning',
    fix: fixFn,
  };
}

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

function extractCodeBlocks(content: string): Array<{content: string}> {
  const blocks: Array<{content: string}> = [];
  const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
  
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    blocks.push({ content: match[1] });
  }
  
  return blocks;
}