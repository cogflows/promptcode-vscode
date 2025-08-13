import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { scanFiles, buildPrompt, initializeTokenCounter } from '@promptcode/core';
import { AIProvider } from '../providers/ai-provider';
import { MODELS, DEFAULT_MODEL, getAvailableModels } from '../providers/models';
import { logRun } from '../services/history';
import { spinner } from '../utils/spinner';
import { estimateCost, formatCost } from '../utils/cost';
import { DEFAULT_EXPECTED_COMPLETION } from '../utils/constants';
// Cost threshold for requiring approval
const APPROVAL_COST_THRESHOLD = parseFloat(process.env.PROMPTCODE_COST_THRESHOLD || '0.50');
import { 
  shouldSkipConfirmation,
  isInteractive
} from '../utils/environment';
import { EXIT_CODES, exitWithCode } from '../utils/exit-codes';

interface ExpertOptions {
  path?: string;
  preset?: string;
  files?: string[];
  promptFile?: string;
  model?: string;
  output?: string;
  stream?: boolean;
  models?: boolean;
  savePreset?: string;
  yes?: boolean;
  webSearch?: boolean;
  verbosity?: 'low' | 'medium' | 'high';
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  serviceTier?: 'auto' | 'flex' | 'priority';
  json?: boolean;
  estimateCost?: boolean;
}

const SYSTEM_PROMPT = `You are an expert software engineer helping analyze and improve code. Provide constructive, actionable feedback.

Focus on:
1. Answering the user's specific question accurately
2. Code quality and best practices when reviewing code
3. Potential issues or edge cases
4. Performance and security considerations
5. Clear, concise explanations`;

function listAvailableModels(jsonOutput: boolean = false) {
  const availableModels = getAvailableModels();
  
  if (jsonOutput) {
    // JSON output for programmatic use
    const modelsData = Object.entries(MODELS).map(([key, config]) => ({
      key,
      name: config.name,
      provider: config.provider,
      modelId: config.modelId,
      description: config.description,
      contextWindow: config.contextWindow,
      pricing: {
        inputPerMillion: config.pricing.input,
        outputPerMillion: config.pricing.output
      },
      supportsWebSearch: config.supportsWebSearch,
      available: availableModels.includes(key)
    }));
    
    const providers = ['openai', 'anthropic', 'google', 'xai'].reduce((acc, provider) => {
      const providerModels = modelsData.filter(m => m.provider === provider);
      const hasAvailable = providerModels.some(m => m.available);
      
      acc[provider] = {
        available: hasAvailable,
        models: providerModels.map(m => m.key),
        envVars: {
          openai: ['OPENAI_API_KEY', 'OPENAI_KEY'],
          anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
          google: ['GOOGLE_API_KEY', 'GOOGLE_CLOUD_API_KEY', 'GEMINI_API_KEY'],
          xai: ['XAI_API_KEY', 'GROK_API_KEY']
        }[provider]
      };
      return acc;
    }, {} as Record<string, any>);
    
    const output = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      models: modelsData,
      providers,
      defaultModel: DEFAULT_MODEL,
      availableCount: availableModels.length,
      totalCount: modelsData.length
    };
    
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Human-readable output
    console.log(chalk.bold('\n📋 Available Models:\n'));
    
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
}

export async function expertCommand(question: string | undefined, options: ExpertOptions): Promise<void> {
  // Handle --models flag
  if (options.models) {
    listAvailableModels(options.json || false);
    return;
  }
  
  // Read question from file if --prompt-file is provided
  let finalQuestion = question;
  if (options.promptFile) {
    const promptFilePath = path.resolve(options.promptFile);
    if (!fs.existsSync(promptFilePath)) {
      console.error(chalk.red(`❌ Prompt file not found: ${options.promptFile}`));
      exitWithCode(EXIT_CODES.FILE_NOT_FOUND);
    }
    try {
      finalQuestion = await fs.promises.readFile(promptFilePath, 'utf8');
      console.log(chalk.gray(`📄 Using prompt from: ${options.promptFile}`));
    } catch (error) {
      console.error(chalk.red(`❌ Error reading prompt file: ${(error as Error).message}`));
      exitWithCode(EXIT_CODES.FILE_NOT_FOUND);
    }
  }
  
  // Require question for actual consultation
  if (!finalQuestion) {
    console.error(chalk.red('🙋 I need a question to ask the AI expert.\n'));
    console.error(chalk.yellow('Examples:'));
    console.error(chalk.gray('  promptcode expert "Why is this slow?" -f src/**/*.ts'));
    console.error(chalk.gray('  promptcode expert "Explain the auth flow" -f backend/**/*.ts'));
    console.error(chalk.gray('  promptcode expert "What are the security risks?" --preset api'));
    console.error(chalk.gray('  promptcode expert --prompt-file analysis.md --preset backend\n'));
    console.error(chalk.gray('To list available models: promptcode expert --models'));
    exitWithCode(EXIT_CODES.INVALID_INPUT);
  }
  
  question = finalQuestion;
  
  // In non-interactive agent environments, provide additional guidance
  if (process.env.CLAUDE_PROJECT_DIR && !options.yes) {
    console.log(chalk.gray('💡 In non-interactive agent environments, ask the user for cost approval before re-running with --yes.'));
  }
  
  // Early validation: Check if the selected model is available
  const modelKey = options.model || DEFAULT_MODEL;
  const modelConfig = MODELS[modelKey];
  
  if (!modelConfig) {
    const available = getAvailableModels();
    console.error(chalk.red(`Unknown model: ${modelKey}. Available models: ${available.join(', ')}`));
    exitWithCode(EXIT_CODES.INVALID_INPUT);
  }
  
  // Check if API key is configured for the provider
  const availableModels = getAvailableModels();
  if (!availableModels.includes(modelKey)) {
    const envVars = {
      openai: 'OPENAI_API_KEY or OPENAI_KEY',
      anthropic: 'ANTHROPIC_API_KEY or CLAUDE_API_KEY',
      google: 'GOOGLE_API_KEY, GOOGLE_CLOUD_API_KEY, or GEMINI_API_KEY',
      xai: 'XAI_API_KEY or GROK_API_KEY'
    };
    console.error(chalk.red(`\n❌ API key not configured for ${modelConfig.provider}.`));
    console.error(chalk.yellow(`\nTo use ${modelConfig.name}, set the environment variable:`));
    console.error(chalk.gray(`  export ${envVars[modelConfig.provider as keyof typeof envVars]}=<your-key>`));
    console.error(chalk.gray(`\nOr use a different model with --model flag. Run 'promptcode expert --models' to see available options.`));
    exitWithCode(EXIT_CODES.MISSING_API_KEY);
  }
  
  const spin = (!options.stream && !options.json) ? spinner() : null;
  if (spin) {spin.start('Preparing context...');}
  
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
    } else if (options.promptFile) {
      // When using prompt-file without files/preset, don't scan any files by default
      // The user can specify files/preset if they want context
      patterns = [];
      console.log(chalk.gray('💡 No files specified. Use -f or --preset to include code context.'));
    } else {
      // Default to all files only when not using prompt-file
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
    
    // Scan files only if patterns exist
    let files: any[] = [];
    let result: any;
    
    if (patterns.length > 0) {
      files = await scanFiles({
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
        exitWithCode(EXIT_CODES.FILE_NOT_FOUND);
      }
      
      // Build context with files
      result = await buildPrompt(files, '', {
        includeFiles: true,
        includeInstructions: false,
        includeFileContents: true
      });
    } else {
      // No files to scan - create minimal result for prompt-only queries
      // But we need to count tokens from the prompt/question itself
      const { countTokens } = await import('@promptcode/core');
      const promptTokens = countTokens(question || '');
      
      result = {
        prompt: '',
        tokenCount: promptTokens,
        fileCount: 0
      };
    }
    
    // Model already validated earlier, just use it
    
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
      exitWithCode(EXIT_CODES.CONTEXT_TOO_LARGE);
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
    const expectedOutput = Math.min(availableTokens, DEFAULT_EXPECTED_COMPLETION);
    const estimatedTotalCost = estimateCost(modelKey, result.tokenCount, expectedOutput);
    const estimatedInputCost = (result.tokenCount / 1_000_000) * modelConfig.pricing.input;
    const estimatedOutputCost = (expectedOutput / 1_000_000) * modelConfig.pricing.output;
    
    // Handle --estimate-cost flag (dry-run mode)
    if (options.estimateCost) {
      if (options.json) {
        // JSON output for programmatic use
        const costEstimate = {
          schemaVersion: 1,
          estimatedAt: new Date().toISOString(),
          model: modelKey,
          modelName: modelConfig.name,
          provider: modelConfig.provider,
          contextWindow: modelConfig.contextWindow,
          pricing: {
            inputPerMillion: modelConfig.pricing.input,
            outputPerMillion: modelConfig.pricing.output
          },
          tokens: {
            input: result.tokenCount,
            expectedOutput: expectedOutput,
            availableForOutput: availableTokens,
            total: result.tokenCount + expectedOutput
          },
          cost: {
            input: estimatedInputCost,
            output: estimatedOutputCost,
            total: estimatedTotalCost
          },
          fileCount: files.length,
          patterns: patterns.length > 0 ? patterns : undefined,
          preset: options.preset || undefined,
          webSearchEnabled: modelConfig.supportsWebSearch && options.webSearch !== false
        };
        console.log(JSON.stringify(costEstimate, null, 2));
      } else {
        // Human-readable output
        console.log(chalk.blue('\n📊 Cost Estimate (Dry Run):'));
        console.log(chalk.gray(`  Model:  ${modelConfig.name} (${modelKey})`));
        console.log(chalk.gray(`  Input:  ${result.tokenCount.toLocaleString()} tokens × $${modelConfig.pricing.input}/M = $${estimatedInputCost.toFixed(4)}`));
        console.log(chalk.gray(`  Output: ~${expectedOutput.toLocaleString()} tokens × $${modelConfig.pricing.output}/M = $${estimatedOutputCost.toFixed(4)}`));
        console.log(chalk.bold(`  Total:  ~$${estimatedTotalCost.toFixed(4)}`));
        console.log(chalk.gray(`\n  Files:  ${files.length} files included`));
        console.log(chalk.gray(`  Context: ${result.tokenCount.toLocaleString()}/${modelConfig.contextWindow.toLocaleString()} tokens used`));
        if (modelConfig.supportsWebSearch && options.webSearch !== false) {
          console.log(chalk.cyan('  Web:    Search enabled'));
        }
        console.log(chalk.yellow('\n💡 This is a cost estimate only. No API call was made.'));
        console.log(chalk.gray('Remove --estimate-cost to run the actual query.'));
      }
      
      // Exit with success code
      exitWithCode(EXIT_CODES.SUCCESS);
    }

    // Show cost info (skip in JSON mode - it will be in the JSON output)
    if (!options.json) {
      console.error(chalk.blue('\n📊 Cost Breakdown:'));
      console.error(chalk.gray(`  Input:  ${result.tokenCount.toLocaleString()} tokens × $${modelConfig.pricing.input}/M = $${estimatedInputCost.toFixed(4)}`));
      console.error(chalk.gray(`  Output: ~${expectedOutput.toLocaleString()} tokens × $${modelConfig.pricing.output}/M = $${estimatedOutputCost.toFixed(4)}`));
      console.error(chalk.bold(`  Total:  ~$${estimatedTotalCost.toFixed(4)}`));
    }

    // Check if approval is needed
    const skipConfirm = shouldSkipConfirmation(options);
    const isExpensive = estimatedTotalCost > APPROVAL_COST_THRESHOLD;
    
    if (!skipConfirm && (isExpensive || modelKey.includes('pro'))) {
      if (!isInteractive()) {
        console.error(chalk.yellow('\n⚠️  Cost approval required for expensive operation (~$' + estimatedTotalCost.toFixed(2) + ')'));
        console.error(chalk.yellow('\nNon-interactive environment detected.'));
        console.error(chalk.yellow('Use --yes to proceed with approval after getting user confirmation.'));
        exitWithCode(EXIT_CODES.APPROVAL_REQUIRED);
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
        exitWithCode(EXIT_CODES.OPERATION_CANCELLED);
      }
    }

    // Prepare the prompt
    const fullPrompt = result.prompt 
      ? `Here is the codebase context:\n\n${result.prompt}\n\n${question}`
      : question || '';
    
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
    
    // Show web search status and warnings (skip in JSON mode)
    if (!options.json) {
      if (modelConfig.supportsWebSearch && webSearchEnabled !== false) {
        console.log(chalk.cyan('🔍 Web search enabled for current information\n'));
      } else if (webSearchEnabled === true && !modelConfig.supportsWebSearch) {
        // User explicitly requested web search but model doesn't support it
        console.log(chalk.yellow(`⚠️  ${modelConfig.name} does not support web search. Proceeding without web search.\n`));
      }
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
        textVerbosity: options.verbosity,
        reasoningEffort: options.reasoningEffort,
        serviceTier: options.serviceTier,
      });
      console.log(); // Add newline after streaming
    } else {
      response = await aiProvider.generateText(modelKey, fullPrompt, {
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: availableTokens,
        webSearch: webSearchEnabled,
        textVerbosity: options.verbosity,
        reasoningEffort: options.reasoningEffort,
        serviceTier: options.serviceTier,
      });
    }
    
    const responseTime = (Date.now() - startTime) / 1000;
    
    // Calculate cost for JSON output
    const cost = response.usage && response.usage.promptTokens !== undefined
      ? aiProvider.calculateCost(modelKey, response.usage)
      : null;
    
    if (options.json) {
      // JSON output for programmatic use
      const jsonResult = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        model: modelKey,
        question: question || '',
        response: response.text,
        usage: response.usage ? {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: (response.usage.promptTokens || 0) + (response.usage.completionTokens || 0)
        } : null,
        costBreakdown: {
          estimatedInput: estimatedInputCost,
          estimatedOutput: estimatedOutputCost,
          estimatedTotal: estimatedTotalCost,
          actualTotal: cost
        },
        responseTime: responseTime,
        fileCount: files.length,
        contextTokens: result.tokenCount,
        webSearchEnabled: modelConfig.supportsWebSearch && options.webSearch !== false
      };
      console.log(JSON.stringify(jsonResult, null, 2));
    } else {
      // Regular output
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
        if (cost !== null) {
          console.log(chalk.gray(`💰 Cost: $${cost.toFixed(4)}`));
        }
      }
    }
    
    // Log to history
    await logRun('expert', patterns, projectPath, {
      question,
      fileCount: files.length,
      tokenCount: result.tokenCount,
      model: modelKey
    });
    
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: (error as Error).message }, null, 2));
      exitWithCode(EXIT_CODES.GENERAL_ERROR);
    }
    
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
      exitWithCode(EXIT_CODES.CONTEXT_TOO_LARGE);
      return; // This won't be reached but helps TypeScript
    }
    
    // Helpful error messages
    if ((error as Error).message.includes('API key')) {
      console.log(chalk.yellow('\nTo configure API keys:'));
      console.log('1. Set environment variables (any of these):');
      console.log('   export OPENAI_API_KEY="sk-..."        # or OPENAI_KEY');
      console.log('   export ANTHROPIC_API_KEY="sk-ant-..."  # or CLAUDE_API_KEY');
      console.log('   export GOOGLE_API_KEY="..."            # or GOOGLE_CLOUD_API_KEY, GEMINI_API_KEY');
      console.log('   export XAI_API_KEY="..."               # or GROK_API_KEY');
      exitWithCode(EXIT_CODES.MISSING_API_KEY);
      return; // This won't be reached but helps TypeScript
    }
    
    // Default to general error for other cases
    exitWithCode(EXIT_CODES.GENERAL_ERROR);
  }
}