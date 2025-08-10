import chalk from 'chalk';
import { ConfigService } from '../services/config-service';

interface ConfigOptions {
  show?: boolean;
}

/**
 * Config command implementation
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  try {
    // Get effective configuration (from env vars only)
    const configService = new ConfigService();
    const effectiveKeys = configService.getAllKeys();
    
    console.log(chalk.bold('PromptCode Configuration'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log('API keys are configured via environment variables only');
    console.log('');
    
    // Show status for each provider
    const showKeyStatus = (provider: string, key: string | undefined) => {
      if (key) {
        return chalk.green('✓ Set');
      }
      return chalk.yellow('✗ Not set');
    };
    
    console.log(`OpenAI:    ${showKeyStatus('openai', effectiveKeys.openai)}`);
    console.log(`Anthropic: ${showKeyStatus('anthropic', effectiveKeys.anthropic)}`);
    console.log(`Google:    ${showKeyStatus('google', effectiveKeys.google)}`);
    console.log(`xAI:       ${showKeyStatus('xai', effectiveKeys.xai)}`);
    
    const hasAnyKey = effectiveKeys.openai || effectiveKeys.anthropic || effectiveKeys.google || effectiveKeys.xai;
    if (!hasAnyKey) {
      console.log(chalk.yellow('\nSet API keys via environment variables:'));
      console.log('  export OPENAI_API_KEY=<key>');
      console.log('  export ANTHROPIC_API_KEY=<key>');
      console.log('  export GOOGLE_API_KEY=<key>');
      console.log('  export XAI_API_KEY=<key>');
      console.log('');
      console.log('Alternative environment variable names:');
      console.log('  CLAUDE_API_KEY (for Anthropic)');
      console.log('  GEMINI_API_KEY (for Google)');
      console.log('  GROK_API_KEY (for xAI)');
    }
    
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}