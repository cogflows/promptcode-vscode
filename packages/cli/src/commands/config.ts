import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { ConfigService } from '../services/config-service';

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
      console.log('\nEnvironment variables (first match wins):');
      console.log('  OpenAI:     OPENAI_API_KEY, OPENAI_KEY');
      console.log('  Anthropic:  ANTHROPIC_API_KEY, CLAUDE_API_KEY');
      console.log('  Google:     GOOGLE_API_KEY, GOOGLE_CLOUD_API_KEY, GOOGLE_AI_API_KEY, GEMINI_API_KEY');
      console.log('  xAI:        XAI_API_KEY, GROK_API_KEY');
      console.log('  XDG_CONFIG_HOME     Config directory (default: ~/.config)');
      console.log('  XDG_CACHE_HOME      Cache directory (default: ~/.cache)');
    }
    
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}