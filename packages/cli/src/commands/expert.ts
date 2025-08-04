import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { scanFiles, buildPrompt, initializeTokenCounter } from '@promptcode/core';
import { AIProvider } from '../providers/ai-provider';
import { MODELS, DEFAULT_MODEL, getAvailableModels } from '../providers/models';

interface ExpertOptions {
  path?: string;
  preset?: string;
  files?: string[];
  model?: string;
  output?: string;
  stream?: boolean;
  listModels?: boolean;
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
      console.log(chalk.yellow(`     Set ${provider.toUpperCase()}_API_KEY to enable these models\n`));
    } else {
      console.log();
    }
  });
  
  console.log(chalk.gray('✓ = Available (API key configured)'));
  console.log(chalk.gray('✗ = Unavailable (missing API key)\n'));
}

export async function expertCommand(question: string | undefined, options: ExpertOptions): Promise<void> {
  // Handle --list-models flag
  if (options.listModels) {
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
    console.error(chalk.gray('To list available models: promptcode expert --list-models'));
    process.exit(1);
  }
  const spinner = !options.stream ? ora('Preparing context...').start() : null;
  
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
    
    // Scan files
    const files = await scanFiles({
      cwd: projectPath,
      patterns,
      respectGitignore: true,
      workspaceName: path.basename(projectPath)
    });
    
    if (files.length === 0) {
      spinner?.fail('No files found matching patterns');
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
      spinner?.fail(`Unknown model: ${modelKey}. Available models: ${available.join(', ')}`);
      return;
    }
    
    /* ──────────────────────────────────────────────────────────
     *  Token-limit enforcement
     * ────────────────────────────────────────────────────────── */
    const SAFETY_MARGIN = 256; // leave room for stop-tokens & metadata
    const availableTokens =
      modelConfig.contextWindow - result.tokenCount - SAFETY_MARGIN;

    if (availableTokens <= 0) {
      spinner?.fail(
        `Prompt size (${result.tokenCount.toLocaleString()} tokens) exceeds the ${modelConfig.contextWindow.toLocaleString()}-token window of "${modelConfig.name}".\n` +
          'Reduce the number of files or switch to a larger-context model.',
      );
      return;
    }

    if (availableTokens < modelConfig.contextWindow * 0.2) {
      spinner?.warn(
        `Large context: ${result.tokenCount.toLocaleString()} tokens. ` +
          `${availableTokens.toLocaleString()} tokens remain for the response.`,
      );
    }

    // Prepare the prompt
    const fullPrompt =
      `Here is the codebase context:\n\n${result.prompt}\n\n${question}`;
    
    if (spinner) {
      spinner.text = `Consulting ${modelConfig.name}...`;
    } else if (options.stream) {
      console.log(chalk.blue(`\n🤖 Consulting ${modelConfig.name}...`));
      console.log(chalk.gray(`📊 ${modelConfig.description}`));
      console.log(chalk.gray('⏳ This may take a moment...\n'));
    }
    
    // Call AI
    const startTime = Date.now();
    let response: { text: string; usage?: any };
    
    if (options.stream) {
      response = await aiProvider.streamText(modelKey, fullPrompt, {
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: availableTokens,
        onChunk: (chunk) => process.stdout.write(chunk),
      });
      console.log(); // Add newline after streaming
    } else {
      response = await aiProvider.generateText(modelKey, fullPrompt, {
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: availableTokens,
      });
    }
    
    const responseTime = (Date.now() - startTime) / 1000;
    
    if (!options.stream) {
      spinner?.succeed('Expert consultation complete');
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
    
  } catch (error) {
    spinner?.fail(chalk.red(`Error: ${(error as Error).message}`));

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
      console.log('1. Set environment variables:');
      console.log('   export OPENAI_API_KEY="sk-..."');
      console.log('   export ANTHROPIC_API_KEY="sk-ant-..."');
      console.log('   export GOOGLE_API_KEY="..."');
      console.log('\n2. Or run: promptcode config --set-<provider>-key <key>');
    }
    
    process.exit(1);
  }
}