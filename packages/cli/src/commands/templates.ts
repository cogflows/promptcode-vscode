import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';

/**
 * List available templates
 */
export async function listTemplates(): Promise<void> {
  console.log(chalk.bold('Available Templates:'));
  console.log(chalk.gray('─'.repeat(50)));
  
  // Check user templates
  const userTemplateDir = process.env.XDG_CONFIG_HOME 
    ? path.join(process.env.XDG_CONFIG_HOME, 'promptcode/prompts')
    : path.join(process.env.HOME || '', '.config/promptcode/prompts');
    
  if (fs.existsSync(userTemplateDir)) {
    console.log(chalk.cyan('\nUser Templates:'));
    try {
      const files = await fs.promises.readdir(userTemplateDir);
      const templates = files.filter(f => f.endsWith('.md'));
      
      if (templates.length > 0) {
        for (const template of templates) {
          const name = path.basename(template, '.md');
          console.log(`  • ${name}`);
          
          // Try to read first line as description
          try {
            const content = await fs.promises.readFile(path.join(userTemplateDir, template), 'utf8');
            const firstLine = content.split('\n')[0];
            if (firstLine.startsWith('#')) {
              console.log(chalk.gray(`    ${firstLine.replace(/^#+\s*/, '').trim()}`));
            }
          } catch {}
        }
      } else {
        console.log(chalk.gray('  (none)'));
      }
    } catch (error) {
      console.log(chalk.gray('  (unable to read)'));
    }
  }
  
  // Check built-in templates
  console.log(chalk.cyan('\nBuilt-in Templates:'));
  const builtInDir = path.join(__dirname, '../../assets/prompts');
  
  if (fs.existsSync(builtInDir)) {
    try {
      const files = await fs.promises.readdir(builtInDir);
      const templates = files.filter(f => f.endsWith('.md'));
      
      for (const template of templates) {
        const name = path.basename(template, '.md');
        console.log(`  • ${name}`);
        
        // Try to read first line as description
        try {
          const content = await fs.promises.readFile(path.join(builtInDir, template), 'utf8');
          const firstLine = content.split('\n')[0];
          if (firstLine.startsWith('#')) {
            console.log(chalk.gray(`    ${firstLine.replace(/^#+\s*/, '').trim()}`));
          }
        } catch {}
      }
    } catch {
      console.log(chalk.gray('  (none available)'));
    }
  } else {
    console.log(chalk.gray('  • code-review'));
    console.log(chalk.gray('  • refactor'));
    console.log(chalk.gray('  • optimize'));
    console.log(chalk.gray('  • document'));
    console.log(chalk.gray('  • test'));
  }
  
  console.log(chalk.gray('\n' + '─'.repeat(50)));
  console.log(chalk.gray('User template directory: ' + userTemplateDir));
}