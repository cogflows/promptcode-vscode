import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { ConfigService } from '../services/config-service';

interface ConfigOptions {
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
    if (options.show || (!options.reset)) {
      // Show current config
      const config = await loadConfig();
      const configPath = getConfigPath();
      
      // Get effective configuration (including env vars)
      const configService = new ConfigService();
      const effectiveKeys = configService.getAllKeys();
      
      console.log(chalk.bold('PromptCode Configuration'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Config file: ${configPath}`);
      
      // Show effective configuration with source
      const showKeyStatus = (provider: string, fileKey: string | undefined, effectiveKey: string | undefined) => {
        if (effectiveKey) {
          if (fileKey) {
            return chalk.green('Set (config file)');
          } else {
            return chalk.green('Set (environment)');
          }
        }
        return chalk.yellow('Not set');
      };
      
      console.log(`OpenAI API key: ${showKeyStatus('openai', config.openaiApiKey, effectiveKeys.openai)}`);
      console.log(`Anthropic API key: ${showKeyStatus('anthropic', config.anthropicApiKey, effectiveKeys.anthropic)}`);
      console.log(`Google API key: ${showKeyStatus('google', config.googleApiKey, effectiveKeys.google)}`);
      console.log(`xAI API key: ${showKeyStatus('xai', config.xaiApiKey, effectiveKeys.xai)}`);
      console.log(`Default model: ${config.defaultModel || 'o3'}`);
      console.log(`Cache directory: ${config.cacheDir || '~/.cache/promptcode'}`);
      
      const hasAnyKey = effectiveKeys.openai || effectiveKeys.anthropic || effectiveKeys.google || effectiveKeys.xai;
      if (!hasAnyKey) {
        console.log(chalk.yellow('\nSet API keys via environment variables:'));
        console.log('  export OPENAI_API_KEY=<key>');
        console.log('  export ANTHROPIC_API_KEY=<key>');
        console.log('  export GOOGLE_API_KEY=<key>');
        console.log('  export GROK_API_KEY=<key>');
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
      
    }
    
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}