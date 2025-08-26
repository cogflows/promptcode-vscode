import chalk from 'chalk';
import { getAvailableModels, MODELS, DEFAULT_MODEL } from '../providers/models';
import { formatCost } from '../utils/cost';

interface ModelsOptions {
  json?: boolean;
  all?: boolean;
}

export async function modelsCommand(options: ModelsOptions): Promise<void> {
  try {
    const availableModels = getAvailableModels();
    
    if (options.json) {
      const output = options.all ? {
        defaultModel: DEFAULT_MODEL,
        available: availableModels.map(key => ({
          id: key,
          ...MODELS[key],
        })),
        all: Object.entries(MODELS).map(([key, config]) => ({
          id: key,
          ...config,
          available: availableModels.includes(key)
        }))
      } : {
        defaultModel: DEFAULT_MODEL,
        models: availableModels.map(key => ({
          id: key,
          ...MODELS[key],
        }))
      };
      
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    
    // Human-readable output
    console.log(chalk.bold('\n📋 Available Models\n'));
    console.log(chalk.gray('Models with configured API keys:\n'));
    
    if (availableModels.length === 0) {
      console.log(chalk.yellow('No models available. Please configure API keys:'));
      console.log(chalk.gray('  export OPENAI_API_KEY=sk-...'));
      console.log(chalk.gray('  export ANTHROPIC_API_KEY=sk-ant-...'));
      console.log(chalk.gray('  export GOOGLE_API_KEY=...'));
      console.log(chalk.gray('  export XAI_API_KEY=xai-...'));
      return;
    }
    
    // Group models by provider
    const byProvider: Record<string, string[]> = {};
    
    for (const modelKey of availableModels) {
      const config = MODELS[modelKey];
      const provider = config.provider;
      if (!byProvider[provider]) {
        byProvider[provider] = [];
      }
      byProvider[provider].push(modelKey);
    }
    
    // Display models grouped by provider
    for (const [provider, models] of Object.entries(byProvider)) {
      console.log(chalk.cyan(`${provider}:`));
      
      for (const modelKey of models) {
        const config = MODELS[modelKey];
        const isDefault = modelKey === DEFAULT_MODEL;
        const defaultMarker = isDefault ? chalk.green(' (default)') : '';
        
        console.log(`  ${chalk.bold(modelKey)}${defaultMarker}`);
        
        if (config.aliases && config.aliases.length > 0) {
          console.log(chalk.gray(`    Aliases: ${config.aliases.join(', ')}`));
        }
        
        // Show pricing
        const inputCost = formatCost(config.pricing.input / 1000); // per 1K tokens
        const outputCost = formatCost(config.pricing.output / 1000); // per 1K tokens
        console.log(chalk.gray(`    Pricing: ${inputCost}/1K input, ${outputCost}/1K output`));
        
        // Show capabilities
        if (config.supportsWebSearch) {
          console.log(chalk.gray(`    Features: web search`));
        }
        
        // Show context window
        if (config.contextWindow) {
          console.log(chalk.gray(`    Context window: ${config.contextWindow.toLocaleString()} tokens`));
        }
        
        console.log();
      }
    }
    
    if (options.all) {
      console.log(chalk.bold('\n🔒 Unavailable Models\n'));
      console.log(chalk.gray('Models requiring API key configuration:\n'));
      
      const unavailable = Object.keys(MODELS).filter(key => !availableModels.includes(key));
      const unavailableByProvider: Record<string, string[]> = {};
      
      for (const modelKey of unavailable) {
        const config = MODELS[modelKey];
        const provider = config.provider;
        if (!unavailableByProvider[provider]) {
          unavailableByProvider[provider] = [];
        }
        unavailableByProvider[provider].push(modelKey);
      }
      
      for (const [provider, models] of Object.entries(unavailableByProvider)) {
        console.log(chalk.gray(`${provider}: ${models.join(', ')}`));
      }
    }
    
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}