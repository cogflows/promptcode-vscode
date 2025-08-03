import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';

interface ConfigOptions {
  setOpenaiKey?: string;
  show?: boolean;
  reset?: boolean;
}

interface Config {
  openaiApiKey?: string;
  defaultModel?: string;
  cacheDir?: string;
}

/**
 * Get config file path
 */
function getConfigPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME 
    ? path.join(process.env.XDG_CONFIG_HOME, 'promptcode')
    : path.join(process.env.HOME || '', '.config', 'promptcode');
  
  return path.join(configDir, 'config.json');
}

/**
 * Load config
 */
async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();
  
  if (!fs.existsSync(configPath)) {
    return {};
  }
  
  try {
    const content = await fs.promises.readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save config
 */
async function saveConfig(config: Config): Promise<void> {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  await fs.promises.mkdir(configDir, { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
}

/**
 * Config command implementation
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  try {
    if (options.setOpenaiKey) {
      // Set OpenAI API key
      const config = await loadConfig();
      config.openaiApiKey = options.setOpenaiKey;
      await saveConfig(config);
      
      console.log(chalk.green('✓ OpenAI API key saved'));
      console.log(chalk.gray('You can now use: promptcode expert <question>'));
      
    } else if (options.show) {
      // Show current config
      const config = await loadConfig();
      const configPath = getConfigPath();
      
      console.log(chalk.bold('PromptCode Configuration'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Config file: ${configPath}`);
      console.log(`OpenAI API key: ${config.openaiApiKey ? chalk.green('Set') : chalk.yellow('Not set')}`);
      console.log(`Default model: ${config.defaultModel || 'gpt-4-turbo-preview'}`);
      console.log(`Cache directory: ${config.cacheDir || '~/.cache/promptcode'}`);
      
      if (!config.openaiApiKey) {
        console.log(chalk.yellow('\nSet API key with: promptcode config --set-openai-key <key>'));
      }
      
    } else if (options.reset) {
      // Reset config
      const configPath = getConfigPath();
      if (fs.existsSync(configPath)) {
        await fs.promises.unlink(configPath);
        console.log(chalk.green('✓ Configuration reset'));
      } else {
        console.log(chalk.yellow('No configuration to reset'));
      }
      
    } else {
      // Show help
      console.log(chalk.bold('PromptCode Configuration'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log('Commands:');
      console.log('  promptcode config --show                    Show current configuration');
      console.log('  promptcode config --set-openai-key <key>    Set OpenAI API key');
      console.log('  promptcode config --reset                   Reset configuration');
      console.log('\nEnvironment variables:');
      console.log('  OPENAI_API_KEY    OpenAI API key (overrides config)');
      console.log('  XDG_CONFIG_HOME   Config directory (default: ~/.config)');
      console.log('  XDG_CACHE_HOME    Cache directory (default: ~/.cache)');
    }
    
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}