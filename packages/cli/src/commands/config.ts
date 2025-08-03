import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';

interface ConfigOptions {
  setOpenaiKey?: string;
  setAnthropicKey?: string;
  setGoogleKey?: string;
  setXaiKey?: string;
  show?: boolean;
  reset?: boolean;
}

interface Config {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  xaiApiKey?: string;
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
    if (options.setOpenaiKey || options.setAnthropicKey || options.setGoogleKey || options.setXaiKey) {
      const config = await loadConfig();
      
      if (options.setOpenaiKey) {
        config.openaiApiKey = options.setOpenaiKey;
        console.log(chalk.green('✓ OpenAI API key saved'));
      }
      if (options.setAnthropicKey) {
        config.anthropicApiKey = options.setAnthropicKey;
        console.log(chalk.green('✓ Anthropic API key saved'));
      }
      if (options.setGoogleKey) {
        config.googleApiKey = options.setGoogleKey;
        console.log(chalk.green('✓ Google API key saved'));
      }
      if (options.setXaiKey) {
        config.xaiApiKey = options.setXaiKey;
        console.log(chalk.green('✓ xAI API key saved'));
      }
      
      await saveConfig(config);
      console.log(chalk.gray('You can now use: promptcode expert <question>'));
      
    } else if (options.show) {
      // Show current config
      const config = await loadConfig();
      const configPath = getConfigPath();
      
      console.log(chalk.bold('PromptCode Configuration'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Config file: ${configPath}`);
      console.log(`OpenAI API key: ${config.openaiApiKey ? chalk.green('Set') : chalk.yellow('Not set')}`);
      console.log(`Anthropic API key: ${config.anthropicApiKey ? chalk.green('Set') : chalk.yellow('Not set')}`);
      console.log(`Google API key: ${config.googleApiKey ? chalk.green('Set') : chalk.yellow('Not set')}`);
      console.log(`xAI API key: ${config.xaiApiKey ? chalk.green('Set') : chalk.yellow('Not set')}`);
      console.log(`Default model: ${config.defaultModel || 'o3'}`);
      console.log(`Cache directory: ${config.cacheDir || '~/.cache/promptcode'}`);
      
      const hasAnyKey = config.openaiApiKey || config.anthropicApiKey || config.googleApiKey || config.xaiApiKey;
      if (!hasAnyKey) {
        console.log(chalk.yellow('\nSet API keys with:'));
        console.log('  promptcode config --set-openai-key <key>');
        console.log('  promptcode config --set-anthropic-key <key>');
        console.log('  promptcode config --set-google-key <key>');
        console.log('  promptcode config --set-xai-key <key>');
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
      console.log('  promptcode config --show                       Show current configuration');
      console.log('  promptcode config --set-openai-key <key>       Set OpenAI API key');
      console.log('  promptcode config --set-anthropic-key <key>    Set Anthropic API key');
      console.log('  promptcode config --set-google-key <key>       Set Google API key');
      console.log('  promptcode config --set-xai-key <key>          Set xAI API key');
      console.log('  promptcode config --reset                      Reset configuration');
      console.log('\nEnvironment variables:');
      console.log('  OPENAI_API_KEY      OpenAI API key (overrides config)');
      console.log('  ANTHROPIC_API_KEY   Anthropic API key (overrides config)');
      console.log('  GOOGLE_API_KEY      Google API key (overrides config)');
      console.log('  XAI_API_KEY         xAI API key (overrides config)');
      console.log('  XDG_CONFIG_HOME     Config directory (default: ~/.config)');
      console.log('  XDG_CACHE_HOME      Cache directory (default: ~/.cache)');
    }
    
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}