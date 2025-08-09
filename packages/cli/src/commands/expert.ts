import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { scanFiles, buildPrompt, initializeTokenCounter } from '@promptcode/core';
import { AIProvider } from '../providers/ai-provider';
import { MODELS, DEFAULT_MODEL, getAvailableModels } from '../providers/models';
import { logRun } from '../services/history';
import { spinner } from '../utils/spinner';
// Cost threshold for requiring approval
const APPROVAL_COST_THRESHOLD = 0.50;
import { 
  shouldSkipConfirmation,
  isInteractive
} from '../utils/environment';

interface ExpertOptions {
  path?: string;
  preset?: string;
  files?: string[];
  model?: string;
  output?: string;
  stream?: boolean;
  models?: boolean;
  savePreset?: string;
  yes?: boolean;
  webSearch?: boolean;
}

const SYSTEM_PROMPT = `You are an expert software engineer helping analyze and improve code. Provide constructive, actionable feedback.

Focus on:
1. Answering the user's specific question accurately
2. Code quality and best practices when reviewing code
3. Potential issues or edge cases
4. Performance and security considerations
5. Clear, concise explanations`;

function listAvailableModels() {
  console.log(chalk.bold('\n📋 Available Models:\n'));
  
  const availableModels = getAvailableModels();
  const modelsByProvider: Record<string, typeof MODELS[string][]> = {};
  
  // Group by provider
  Object.entries(MODELS).forEach(([key, config]) => {
    if (!modelsByProvider[config.provider]) {
      modelsByProvider[config.provider] = [];
    }
    modelsByProvider[config.provider].push({ ...config, key } as any);
  });
  
  // Display by provider
  Object.entries(modelsByProvider).forEach(([provider, models]) => {
    const hasKey = models.some(m => availableModels.includes((m as any).key));
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
    
    console.log(chalk.blue(`${providerName}:`));
    
    models.forEach(model => {
      const isAvailable = availableModels.includes((model as any).key);
      const status = isAvailable ? chalk.green('✓') : chalk.gray('✗');
      const name = isAvailable ? chalk.cyan((model as any).key) : chalk.gray((model as any).key);
      const pricing = `$${model.pricing.input}/$${model.pricing.output}/M`;
      
      console.log(`  ${status} ${name.padEnd(20)} ${model.description.padEnd(50)} ${chalk.gray(pricing)}`);
    });
    
    if (!hasKey) {
      // Show all supported env vars for this provider
      const envVars = {
        openai: 'OPENAI_API_KEY or OPENAI_KEY',
        anthropic: 'ANTHROPIC_API_KEY or CLAUDE_API_KEY',
        google: 'GOOGLE_API_KEY, GOOGLE_CLOUD_API_KEY, or GEMINI_API_KEY',
        xai: 'XAI_API_KEY or GROK_API_KEY'
      };
      console.log(chalk.yellow(`     Set ${envVars[provider as keyof typeof envVars]} to enable these models\n`));
    } else {
      console.log();
    }
  });
  
  console.log(chalk.gray('✓ = Available (API key configured)'));
  console.log(chalk.gray('✗ = Unavailable (missing API key)\n'));
}

export async function expertCommand(question: string | undefined, options: ExpertOptions): Promise<void> {
  // Handle --models flag
  if (options.models) {
    listAvailableModels();
    return;
  }
  
  // Require question for actual consultation
  if (!question) {
    console.error(chalk.red('🙋 I need a question to ask the AI expert.\n'));
    console.error(chalk.yellow('Examples:'));
    console.error(chalk.gray('  promptcode "Why is this slow?" src/**/*.ts'));
    console.error(chalk.gray('  promptcode "Explain the auth flow" @backend/'));
    console.error(chalk.gray('  promptcode expert "What are the security risks?" --preset api\n'));
    console.error(chalk.gray('To list available models: promptcode expert --models'));
    process.exit(1);
  }
  
  // In Claude Code environment, provide additional guidance
  if (process.env.CLAUDE_PROJECT_DIR && !options.yes) {
    console.log(chalk.gray('💡 In Claude Code: AI agents will ask for approval before expensive operations'));
  }
  
  const spin = !options.stream ? spinner() : null;
  if (spin) spin.start('Preparing context...');
  
  try {
    // Initialize AI provider
    const aiProvider = new AIProvider();
    
    // Initialize token counter
    const cacheDir = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '', '.cache', 'promptcode');
    initializeTokenCounter(cacheDir, '0.1.0');
    
    const projectPath = path.resolve(options.path || process.cwd());
    
    // Determine patterns - prioritize files, then preset, then default
    let patterns: string[];
    
    if (options.files && options.files.length > 0) {
      // Direct files provided - strip @ prefix if present
      patterns = options.files.map(f => f.startsWith('@') ? f.slice(1) : f);
    } else if (options.preset) {
      // Load preset
      const presetPath = path.join(projectPath, '.promptcode', 'presets', `${options.preset}.patterns`);
      if (fs.existsSync(presetPath)) {
        const content = await fs.promises.readFile(presetPath, 'utf8');
        patterns = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
      } else {
        throw new Error(`Preset not found: ${options.preset}\nCreate it with: promptcode preset --create ${options.preset}`);
      }
    } else {
      // Default to all files
      patterns = ['**/*'];
    }
    
    // Save preset if requested
    if (options.savePreset && patterns.length > 0) {
      const presetDir = path.join(projectPath, '.promptcode', 'presets');
      await fs.promises.mkdir(presetDir, { recursive: true });
      const presetPath = path.join(presetDir, `${options.savePreset}.patterns`);
      
      // Check if preset exists
      if (fs.existsSync(presetPath)) {
        // In non-interactive environments, fail to avoid accidental overwrites
        if (!isInteractive()) {
          throw new Error(`Preset '${options.savePreset}' already exists. Remove it first or choose a different name.`);
        }
        // In TTY, we could ask for confirmation, but for now just notify
        console.log(chalk.yellow(`⚠️  Overwriting existing preset: ${options.savePreset}`));
      }
      
      // Write the preset file
      const presetContent = `# ${options.savePreset} preset\n# Created: ${new Date().toISOString()}\n# Question: ${question || 'N/A'}\n\n${patterns.join('\n')}\n`;
      await fs.promises.writeFile(presetPath, presetContent);
      console.log(chalk.green(`✓ Saved file patterns to preset: ${options.savePreset}`));
    }
    
    // Scan files
    const files = await scanFiles({
      cwd: projectPath,
      patterns,
      respectGitignore: true,
      workspaceName: path.basename(projectPath)
    });
    
    if (files.length === 0) {
      if (spin) {
        spin.fail('No files found matching patterns');
        spin.stop(); // Ensure cleanup
      }
      console.error(chalk.yellow('\nTips:'));
      console.error(chalk.gray('  - Check if the path exists: ' + patterns.join(', ')));
      console.error(chalk.gray('  - Try using absolute paths or glob patterns'));
      console.error(chalk.gray('  - Make sure .gitignore is not excluding your files'));
      return;
    }
    
    // Build context
    const result = await buildPrompt(files, '', {
      includeFiles: true,
      includeInstructions: false,
      includeFileContents: true
    });
    
    // Select model
    const modelKey = options.model || DEFAULT_MODEL;
    const modelConfig = MODELS[modelKey];
    
    if (!modelConfig) {
      const available = getAvailableModels();
      if (spin) {
        spin.fail(`Unknown model: ${modelKey}. Available models: ${available.join(', ')}`);
        spin.stop(); // Ensure cleanup
      }
      return;
    }
    
    /* ──────────────────────────────────────────────────────────
     *  Token-limit enforcement
     * ────────────────────────────────────────────────────────── */
    const SAFETY_MARGIN = 256; // leave room for stop-tokens & metadata
    const availableTokens =
      modelConfig.contextWindow - result.tokenCount - SAFETY_MARGIN;

    if (availableTokens <= 0) {
      if (spin) {
        spin.fail(
          `Prompt size (${result.tokenCount.toLocaleString()} tokens) exceeds the ${modelConfig.contextWindow.toLocaleString()}-token window of "${modelConfig.name}".\n` +
            'Reduce the number of files or switch to a larger-context model.',
        );
        spin.stop(); // Ensure cleanup
      }
      return;
    }

    if (availableTokens < modelConfig.contextWindow * 0.2) {
      if (spin) {
        spin.warn(
          `Large context: ${result.tokenCount.toLocaleString()} tokens. ` +
            `${availableTokens.toLocaleString()} tokens remain for the response.`,
        );
      }
    }

    // Calculate estimated costs
    const estimatedInputCost = (result.tokenCount / 1_000_000) * modelConfig.pricing.input;
    const estimatedOutputCost = (Math.min(availableTokens, 4000) / 1_000_000) * modelConfig.pricing.output; // Assume ~4K output
    const estimatedTotalCost = estimatedInputCost + estimatedOutputCost;
    
    // Show cost info (to stderr so it's always visible)
    console.error(chalk.blue('\n📊 Cost Breakdown:'));
    console.error(chalk.gray(`  Input:  ${result.tokenCount.toLocaleString()} tokens × $${modelConfig.pricing.input}/M = $${estimatedInputCost.toFixed(4)}`));
    console.error(chalk.gray(`  Output: ~4,000 tokens × $${modelConfig.pricing.output}/M = $${estimatedOutputCost.toFixed(4)}`));
    console.error(chalk.bold(`  Total:  ~$${estimatedTotalCost.toFixed(4)}`));

    // Check if approval is needed
    const skipConfirm = shouldSkipConfirmation(options);
    const isExpensive = estimatedTotalCost > APPROVAL_COST_THRESHOLD;
    
    if (!skipConfirm && (isExpensive || modelKey.includes('pro'))) {
      if (!isInteractive()) {
        console.error(chalk.yellow('\n⚠️  Cost approval required for expensive operation (~$' + estimatedTotalCost.toFixed(2) + ')'));
        console.error(chalk.yellow('\nNon-interactive environment detected.'));
        console.error(chalk.yellow('Use --yes to proceed with approval.'));
        
        // Special message for Claude Code environment
        if (process.env.CLAUDE_PROJECT_DIR) {
          console.error(chalk.blue('\n💡 Claude Code AI agents: Ask the user for approval before re-running with --yes'));
        }
        
        process.exit(1);
      }
      
      console.log(chalk.yellow(`\n⚠️  This consultation will cost approximately $${estimatedTotalCost.toFixed(2)}`));
      if (modelKey.includes('pro')) {
        console.log(chalk.yellow('   Note: Using premium model with higher costs'));
      }
      
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.bold('\nProceed with consultation? (y/N): '), resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('\nCancelled.'));
        process.exit(0);
      }
    }

    // Prepare the prompt
    const fullPrompt =
      `Here is the codebase context:\n\n${result.prompt}\n\n${question}`;
    
    if (spin) {
      spin.text = `Consulting ${modelConfig.name}...`;
    } else if (options.stream) {
      console.log(chalk.blue(`\n🤖 Consulting ${modelConfig.name}...`));
      console.log(chalk.gray(`📊 ${modelConfig.description}`));
      console.log(chalk.gray('⏳ This may take a moment...\n'));
    }
    
    // Determine web search setting
    // Commander.js sets webSearch to false when --no-web-search is used
    // undefined means use default (enabled for supported models)
    const webSearchEnabled = options.webSearch;
    
    // Show web search status and warnings
    if (modelConfig.supportsWebSearch && webSearchEnabled !== false) {
      console.log(chalk.cyan('🔍 Web search enabled for current information\n'));
    } else if (webSearchEnabled === true && !modelConfig.supportsWebSearch) {
      // User explicitly requested web search but model doesn't support it
      console.log(chalk.yellow(`⚠️  ${modelConfig.name} does not support web search. Proceeding without web search.\n`));
    }
    
    // Call AI
    const startTime = Date.now();
    let response: { text: string; usage?: any };
    
    if (options.stream) {
      response = await aiProvider.streamText(modelKey, fullPrompt, {
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: availableTokens,
        onChunk: (chunk) => process.stdout.write(chunk),
        webSearch: webSearchEnabled,
      });
      console.log(); // Add newline after streaming
    } else {
      response = await aiProvider.generateText(modelKey, fullPrompt, {
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: availableTokens,
        webSearch: webSearchEnabled,
      });
    }
    
    const responseTime = (Date.now() - startTime) / 1000;
    
    if (!options.stream) {
      if (spin) {
        spin.succeed('Expert consultation complete');
        spin.stop(); // Ensure cleanup
      }
      console.log('\n' + response.text);
    }
    
    // Save output if requested
    if (options.output) {
      await fs.promises.writeFile(options.output, response.text);
      console.log(chalk.green(`\n✓ Saved response to ${options.output}`));
    }
    
    // Show statistics
    console.log(chalk.gray(`\n⏱️  Response time: ${responseTime.toFixed(1)}s`));
    
    if (response.usage && response.usage.promptTokens !== undefined) {
      console.log(chalk.gray(`📊 Tokens: ${response.usage.promptTokens.toLocaleString()} in, ${response.usage.completionTokens.toLocaleString()} out`));
      
      const cost = aiProvider.calculateCost(modelKey, response.usage);
      console.log(chalk.gray(`💰 Cost: $${cost.toFixed(4)}`));
    }
    
    // Log to history
    await logRun('expert', patterns, projectPath, {
      question,
      fileCount: files.length,
      tokenCount: result.tokenCount,
      model: modelKey
    });
    
  } catch (error) {
    if (spin) {
      spin.fail(chalk.red(`Error: ${(error as Error).message}`));
      spin.stop(); // Ensure cleanup
    }

    // Helpful message for context-length overflows
    const msg = (error as Error).message.toLowerCase();
    if (
      msg.includes('context_length_exceeded') ||
      msg.includes('maximum context length') ||
      msg.includes('too many tokens')
    ) {
      console.log(
        chalk.yellow(
          '\nThe model reported that the combined prompt + completion exceeds its context window.\n' +
            'Suggestions:\n' +
            ' • Use a smaller preset or fewer file patterns\n' +
            ' • Choose a model with a larger context window\n' +
            ' • Increase the SAFETY_MARGIN only if you know what you are doing\n',
        ),
      );
    }
    
    // Helpful error messages
    if ((error as Error).message.includes('API key')) {
      console.log(chalk.yellow('\nTo configure API keys:'));
      console.log('1. Set environment variables (any of these):');
      console.log('   export OPENAI_API_KEY="sk-..."        # or OPENAI_KEY');
      console.log('   export ANTHROPIC_API_KEY="sk-ant-..."  # or CLAUDE_API_KEY');
      console.log('   export GOOGLE_API_KEY="..."            # or GOOGLE_CLOUD_API_KEY, GEMINI_API_KEY');
      console.log('   export XAI_API_KEY="..."               # or GROK_API_KEY');
    }
    
    process.exit(1);
  }
}