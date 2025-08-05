import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';

interface CcOptions {
  path?: string;
  force?: boolean;
  yes?: boolean;
  uninstall?: boolean;
}

/**
 * Find .claude folder by searching up the directory tree
 */
function findClaudeFolder(startPath: string): string | null {
  let currentPath = path.resolve(startPath);
  const root = path.parse(currentPath).root;
  
  while (currentPath !== root) {
    const candidatePath = path.join(currentPath, '.claude');
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      // We've reached the root
      break;
    }
    currentPath = parentPath;
  }
  
  // Check root directory as well
  const rootCandidate = path.join(root, '.claude');
  if (fs.existsSync(rootCandidate)) {
    return rootCandidate;
  }
  
  return null;
}

/**
 * Create .claude folder structure for AI agents
 */
async function createClaudeStructure(projectPath: string): Promise<string> {
  const claudeDir = path.join(projectPath, '.claude');
  const commandsDir = path.join(claudeDir, 'commands');
  
  // Create directories
  await fs.promises.mkdir(claudeDir, { recursive: true });
  await fs.promises.mkdir(commandsDir, { recursive: true });
  
  // Copy CLAUDE.md template
  const templatePath = path.join(__dirname, '..', '..', 'CLAUDE.md.template');
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
  
  if (fs.existsSync(templatePath)) {
    const content = await fs.promises.readFile(templatePath, 'utf8');
    await fs.promises.writeFile(claudeMdPath, content);
  }
  
  // Create .env.example
  const envExampleContent = `# API Keys for expert consultation
# Get your keys from:
# - OpenAI: https://platform.openai.com/api-keys
# - Anthropic: https://console.anthropic.com/
# - Google: https://makersuite.google.com/app/apikey
# - xAI: https://console.x.ai/

OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
GROK_API_KEY=xai-...
`;
  
  await fs.promises.writeFile(
    path.join(claudeDir, '.env.example'),
    envExampleContent
  );
  
  // Create .gitignore
  const gitignoreContent = `.env
.env.*
!.env.example
*.log
tmp/
`;
  
  await fs.promises.writeFile(
    path.join(claudeDir, '.gitignore'),
    gitignoreContent
  );
  
  // Copy expert consultation command template
  const expertTemplatePath = path.join(__dirname, '..', 'claude-templates', 'expert-consultation.md');
  const expertCommandPath = path.join(commandsDir, 'expert-consultation.md');
  
  if (fs.existsSync(expertTemplatePath)) {
    const content = await fs.promises.readFile(expertTemplatePath, 'utf8');
    await fs.promises.writeFile(expertCommandPath, content);
  }
  
  return claudeDir;
}

/**
 * Remove .claude folder and its contents
 */
async function removeClaudeStructure(claudeDir: string): Promise<void> {
  // Recursively remove the directory
  await fs.promises.rm(claudeDir, { recursive: true, force: true });
}

/**
 * CC command - Set up or remove Claude integration
 */
export async function ccCommand(options: CcOptions): Promise<void> {
  const projectPath = path.resolve(options.path || process.cwd());
  
  // Handle --yes as alias for --force
  if (options.yes) {
    options.force = true;
  }
  
  // Handle uninstall
  if (options.uninstall) {
    const claudeDir = findClaudeFolder(projectPath);
    
    if (!claudeDir) {
      console.log(chalk.yellow('No .claude folder found'));
      return;
    }
    
    const isInCurrentDir = claudeDir === path.join(projectPath, '.claude');
    const location = isInCurrentDir ? 'current directory' : 'parent directory';
    
    // Ask for confirmation
    console.log(chalk.yellow(`\nFound .claude folder in ${location}:`));
    console.log(chalk.gray(claudeDir));
    console.log(chalk.red('\nThis will permanently delete the .claude folder and all its contents.'));
    console.log(chalk.gray('Note: Any .env files with API keys will be removed.'));
    
    // Check if running in interactive mode
    const isInteractive = process.stdout.isTTY && process.stdin.isTTY;
    
    if (!isInteractive && !options.force) {
      console.log(chalk.yellow('\nNon-interactive environment detected. Use --force to skip confirmation.'));
      return;
    }
    
    if (!options.force && isInteractive) {
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.bold('\nAre you sure you want to remove Claude integration? (yes/no): '), resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('\nCancelled.'));
        return;
      }
    }
    
    const spinner = ora('Removing Claude integration...').start();
    
    try {
      await removeClaudeStructure(claudeDir);
      spinner.succeed(chalk.green(`Removed Claude integration from ${location}`));
      console.log(chalk.gray('\nTo reinstall, run: promptcode cc'));
      
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
    
    return;
  }
  
  // Handle setup
  const spinner = ora('Checking for existing Claude integration...').start();
  
  try {
    // Check if .claude already exists (including parent dir)
    const existingClaudeDir = findClaudeFolder(projectPath);
    
    if (existingClaudeDir) {
      const isInCurrentDir = existingClaudeDir === path.join(projectPath, '.claude');
      const location = isInCurrentDir ? 'current directory' : 'parent directory';
      
      if (!options.force) {
        spinner.info(chalk.yellow(`.claude folder already exists in ${location}: ${existingClaudeDir}`));
        console.log(chalk.gray('\nUse --force to update the existing structure'));
        
        // Still copy latest CLAUDE.md if template is newer
        const templatePath = path.join(__dirname, '..', '..', 'CLAUDE.md.template');
        const claudeMdPath = path.join(existingClaudeDir, 'CLAUDE.md');
        
        if (fs.existsSync(templatePath)) {
          const templateStat = await fs.promises.stat(templatePath);
          const claudeMdExists = fs.existsSync(claudeMdPath);
          
          if (!claudeMdExists) {
            const content = await fs.promises.readFile(templatePath, 'utf8');
            await fs.promises.writeFile(claudeMdPath, content);
            console.log(chalk.green('✓ Added missing CLAUDE.md from latest template'));
          } else {
            const claudeMdStat = await fs.promises.stat(claudeMdPath);
            if (templateStat.mtime > claudeMdStat.mtime) {
              console.log(chalk.yellow('\nNewer CLAUDE.md template available. Use --force to update.'));
            }
          }
        }
        
        return;
      } else {
        // With --force, update the existing structure
        spinner.text = `Updating Claude integration in ${location}...`;
        
        // Only update files, don't recreate the whole structure
        const templatePath = path.join(__dirname, '..', '..', 'CLAUDE.md.template');
        const claudeMdPath = path.join(existingClaudeDir, 'CLAUDE.md');
        
        if (fs.existsSync(templatePath)) {
          const content = await fs.promises.readFile(templatePath, 'utf8');
          await fs.promises.writeFile(claudeMdPath, content);
        }
        
        // Update expert consultation command
        const expertTemplatePath = path.join(__dirname, '..', 'claude-templates', 'expert-consultation.md');
        const commandsDir = path.join(existingClaudeDir, 'commands');
        
        if (!fs.existsSync(commandsDir)) {
          await fs.promises.mkdir(commandsDir, { recursive: true });
        }
        
        if (fs.existsSync(expertTemplatePath)) {
          const content = await fs.promises.readFile(expertTemplatePath, 'utf8');
          await fs.promises.writeFile(path.join(commandsDir, 'expert-consultation.md'), content);
        }
        
        spinner.succeed(chalk.green(`Updated Claude integration in ${location}`));
        console.log(chalk.gray(`\nLocation: ${existingClaudeDir}`));
        return;
      }
    }
    
    // No existing .claude folder found, create new
    spinner.text = 'Setting up Claude integration...';
    const claudeDir = await createClaudeStructure(projectPath);
    
    spinner.succeed(chalk.green('Claude integration set up successfully!'));
    
    console.log(chalk.bold('\n📁 Created structure:'));
    console.log(chalk.gray(`${claudeDir}/
├── CLAUDE.md          ${chalk.green('# Instructions for AI agents')}
├── .env.example       ${chalk.green('# API key template')}
├── .gitignore         ${chalk.green('# Git ignore rules')}
└── commands/          ${chalk.green('# Claude-specific commands')}`));
    
    console.log(chalk.bold('\n🚀 Next steps:'));
    console.log(chalk.gray('1. Copy .env.example to .env and add your API keys'));
    console.log(chalk.gray('2. Review CLAUDE.md for promptcode usage tips'));
    console.log(chalk.gray('3. Create presets with: promptcode preset create <name>'));
    
    console.log(chalk.bold('\n💡 Quick start:'));
    console.log(chalk.cyan('  promptcode preset list                    # See available presets'));
    console.log(chalk.cyan('  promptcode expert "Explain this code"     # Ask AI with context'));
    
  } catch (error) {
    spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}