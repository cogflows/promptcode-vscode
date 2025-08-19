import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { scanFiles, buildPrompt, initializeTokenCounter } from '@promptcode/core';
import { AIProvider } from '../providers/ai-provider';
import { MODELS, DEFAULT_MODEL, getAvailableModels, ModelConfig } from '../providers/models';
import { logRun } from '../services/history';
import { spinner } from '../utils/spinner';
import { estimateCost, formatCost } from '../utils/cost';
import { DEFAULT_EXPECTED_COMPLETION } from '../utils/constants';
import { 
  shouldSkipConfirmation,
  isInteractive,
  shouldShowSpinner
} from '../utils/environment';
import { EXIT_CODES, exitWithCode } from '../utils/exit-codes';
import { findPromptcodeFolder, getProjectRoot, getPresetPath, getCacheDir, resolveProjectPath } from '../utils/paths';
import { validatePatterns, validatePresetName } from '../utils/validation';
import { SAFE_DEFAULT_PATTERNS, DEFAULT_SAFETY_MARGIN } from '../utils/constants';

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
  force?: boolean;
  webSearch?: boolean;
  verbosity?: 'low' | 'medium' | 'high';
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  serviceTier?: 'auto' | 'flex' | 'priority';
  json?: boolean;
  estimateCost?: boolean;
  costThreshold?: number;
}

const SYSTEM_PROMPT = `You are an expert software engineer helping analyze and improve code. Provide constructive, actionable feedback.

Focus on:
1. Answering the user's specific question accurately
2. Code quality and best practices when reviewing code
3. Potential issues or edge cases
4. Performance and security considerations
5. Clear, concise explanations`;

/* ──────────────────────────────────────────────────────────
 *  Helpers (refactor for readability + safety)
 * ────────────────────────────────────────────────────────── */

// Use shared validation utility
function validatePatternsWithinProject(patterns: string[]): void {
  validatePatterns(patterns);
}

async function loadPreset(projectPath: string, presetName: string): Promise<string[]> {
  // Get preset path using helper
  const presetPath = getPresetPath(projectPath, presetName);
    
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Preset not found: ${presetName}\nCreate it with: promptcode preset --create ${presetName}`);
  }
  const content = await fs.promises.readFile(presetPath, 'utf8');
  const patterns = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  
  // Validate preset patterns for security
  validatePatternsWithinProject(patterns);
  
  return patterns;
}

async function savePresetSafely(
  projectPath: string,
  presetName: string,
  patterns: string[],
  options: ExpertOptions
): Promise<void> {
  // Use shared validation for preset name
  validatePresetName(presetName);
  
  const presetDir = path.join(projectPath, '.promptcode', 'presets');
  
  // Reject symlinked .promptcode/presets for writes
  const pcDir = path.join(projectPath, '.promptcode');
  const pcStat = await fs.promises.lstat(pcDir).catch(() => null);
  if (pcStat?.isSymbolicLink()) {
    throw new Error('Refusing to write into a symlinked .promptcode directory.');
  }
  
  const presetsStat = await fs.promises.lstat(presetDir).catch(() => null);
  if (presetsStat?.isSymbolicLink()) {
    throw new Error('Refusing to write into a symlinked presets directory.');
  }
  
  await fs.promises.mkdir(presetDir, { recursive: true });
  
  // Defense in depth: ensure realpaths are within real project root
  const projectRootReal = fs.realpathSync(projectPath);
  const presetDirReal = fs.realpathSync(presetDir);
  if (!presetDirReal.startsWith(projectRootReal + path.sep)) {
    throw new Error('Invalid preset directory location detected.');
  }
  
  const presetPath = path.join(presetDirReal, `${presetName}.patterns`);

  if (fs.existsSync(presetPath)) {
    if (!shouldSkipConfirmation(options)) {
      if (!isInteractive()) {
        throw new Error(`Preset '${presetName}' already exists. Re-run with --yes/--force to overwrite.`);
      } else {
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ans = await new Promise<string>((resolve) =>
          rl.question(chalk.bold(`Preset '${presetName}' exists. Overwrite? (y/N): `), resolve)
        );
        rl.close();
        if (!['y', 'yes'].includes(ans.trim().toLowerCase())) {
          throw new Error('Operation cancelled by user.');
        }
      }
    }
  }

  const presetContent = `# ${presetName} preset\n# Created: ${new Date().toISOString()}\n\n${patterns.join('\n')}\n`;
  await fs.promises.writeFile(presetPath, presetContent);
  console.log(chalk.green(`✓ Saved file patterns to preset: ${presetName}`));
}

async function scanProject(projectPath: string, patterns: string[]) {
  // projectPath is already the project root thanks to resolveProjectPath
  const projectRoot = projectPath;
  
  // Separate absolute paths from relative patterns
  const absolutePaths = patterns.filter(p => path.isAbsolute(p));
  const relativePatterns = patterns.filter(p => !path.isAbsolute(p));
  
  // Scan relative patterns normally
  let files = relativePatterns.length > 0 ? await scanFiles({
    cwd: projectRoot,
    patterns: relativePatterns,
    respectGitignore: true,
    workspaceName: path.basename(projectRoot),
    followSymlinks: true,  // Match VS Code extension behavior
  }) : [];
  
  // Handle absolute paths directly
  if (absolutePaths.length > 0) {
    const { countTokensWithCacheDetailed } = await import('@promptcode/core');
    for (const absPath of absolutePaths) {
      try {
        // Check if file exists
        if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
          const { count: tokenCount } = await countTokensWithCacheDetailed(absPath);
          // For absolute paths, use just the filename as the "relative" path
          // This prevents buildPrompt from skipping them
          files.push({
            path: path.basename(absPath),
            absolutePath: absPath,
            tokenCount,
            workspaceFolderRootPath: path.dirname(absPath),
            workspaceFolderName: 'external'
          });
        }
      } catch (err) {
        // Skip files that can't be read
        console.warn(chalk.gray(`Skipping unreadable file: ${absPath}`));
      }
    }
  }
  
  return files;
}

function warnIfFilesOutsideProject(projectPath: string, files: any[]): number {
  const projectRoot = fs.realpathSync(projectPath) + path.sep;
  const externalFiles = files.filter((f) => {
    try {
      // Standardize on absolutePath field (consistent with generate.ts)
      const filePath = f.absolutePath || f.path;
      const abs = fs.realpathSync(filePath);
      return !abs.startsWith(projectRoot);
    } catch (err) {
      // If realpath fails (e.g., broken symlink), count as external
      return true;
    }
  });
  
  if (externalFiles.length > 0 && !process.env.PROMPTCODE_TEST) {
    // Don't show warnings in JSON mode or during tests
    const isJsonMode = process.argv.includes('--json');
    if (!isJsonMode) {
      console.warn(chalk.yellow(`\n⚠️  Note: Including ${externalFiles.length} file(s) from outside the project directory`));
      if (process.env.VERBOSE) {
        console.warn(chalk.gray('   External files:'));
        externalFiles.forEach(f => {
          console.warn(chalk.gray(`   - ${f.path || f.absolutePath}`));
        });
      }
    }
  }
  
  return externalFiles.length;
}

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
    
    const providerSet = new Set(Object.values(MODELS).map(m => m.provider));
    const providers = Array.from(providerSet).reduce((acc, provider) => {
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
    
    type ModelRow = ModelConfig & { key: string };
    const modelsByProvider: Record<string, ModelRow[]> = {};
    
    // Group by provider
    Object.entries(MODELS).forEach(([key, config]) => {
      if (!modelsByProvider[config.provider]) {
        modelsByProvider[config.provider] = [];
      }
      modelsByProvider[config.provider].push({ ...config, key });
    });
    
    // Display by provider
    Object.entries(modelsByProvider).forEach(([provider, models]) => {
      const hasKey = models.some(m => availableModels.includes(m.key));
      const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
      
      console.log(chalk.blue(`${providerName}:`));
      
      models.forEach(model => {
        const isAvailable = availableModels.includes(model.key);
        const status = isAvailable ? chalk.green('✓') : chalk.gray('✗');
        const name = isAvailable ? chalk.cyan(model.key) : chalk.gray(model.key);
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
  // Validate conflicting options
  if (options.json && options.stream) {
    console.error(chalk.red('❌ Cannot use --json and --stream together. Choose one output format.'));
    exitWithCode(EXIT_CODES.INVALID_INPUT);
  }
  
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
      if (!options.json) {
        console.log(chalk.gray(`📄 Using prompt from: ${options.promptFile}`));
      }
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
  if (process.env.CLAUDE_PROJECT_DIR && !(options.yes || options.force)) {
    console.log(chalk.gray('💡 In non-interactive agent environments, ask the user for cost approval before re-running with --yes.'));
  }
  
  // Early validation: Check if the selected model is available
  const modelKey = options.model || DEFAULT_MODEL;
  const modelConfig = MODELS[modelKey];
  
  if (!modelConfig) {
    const known = Object.keys(MODELS);
    console.error(chalk.red(`Unknown model: ${modelKey}. Known models: ${known.join(', ')}`));
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
  
  const spin = (!options.stream && !options.json && shouldShowSpinner({ json: options.json })) ? spinner() : null;
  if (spin) {spin.start('Preparing context...');}
  
  try {
    // Initialize AI provider
    const aiProvider = new AIProvider();
    
    // Initialize token counter
    const cacheDir = getCacheDir();
    initializeTokenCounter(cacheDir, '0.1.0');
    
    // This now intelligently finds the project root
    const projectPath = resolveProjectPath(options.path);
    
    // Determine patterns - prioritize files, then preset, then default (safe)
    let patterns: string[] = [];
    if (options.files && options.files.length > 0) {
      patterns = options.files.map((f) => (f.startsWith('@') ? f.slice(1) : f));
      validatePatternsWithinProject(patterns);
    } else if (options.preset) {
      patterns = await loadPreset(projectPath, options.preset);
    } else if (options.promptFile) {
      // Prompt-file only: no files by default
      patterns = [];
      if (!options.json) {
        console.log(chalk.gray('💡 No files specified. Use -f or --preset to include code context.'));
      }
    } else {
      // Safe default include set (respects .gitignore + conservative excludes)
      patterns = SAFE_DEFAULT_PATTERNS;
    }
    
    // Save preset if requested
    if (options.savePreset && patterns.length > 0) {
      await savePresetSafely(projectPath, options.savePreset, patterns, options);
    }
    
    // Scan files only if patterns exist
    let files: any[] = [];
    let result: any;
    
    if (patterns.length > 0) {
      files = await scanProject(projectPath, patterns);
      // Warn if files are outside project (informational, not blocking)
      const externalCount = warnIfFilesOutsideProject(projectPath, files);
      
      // Optional CI policy: fail if external files detected
      if (process.env.PROMPTCODE_EXTERNAL_FILES === 'deny' && externalCount > 0) {
        throw new Error(`External files detected (${externalCount}). Failing due to PROMPTCODE_EXTERNAL_FILES=deny.`);
      }
      
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
      result = {
        prompt: '',
        tokenCount: 0,  // File context tokens only
        fileCount: 0
      };
    }
    
    // Model already validated earlier, just use it
    
    /* ──────────────────────────────────────────────────────────
     *  Token-limit enforcement
     * ────────────────────────────────────────────────────────── */
    // Import token counting utility
    const { countTokens } = await import('@promptcode/core');
    
    // Calculate all token components
    const systemPromptTokens = SYSTEM_PROMPT ? countTokens(SYSTEM_PROMPT) : 0;
    const questionTokens = question ? countTokens(question) : 0;
    const fileContextTokens = result.tokenCount || 0;
    const totalInputTokens = systemPromptTokens + questionTokens + fileContextTokens;
    
    const availableTokens =
      modelConfig.contextWindow - totalInputTokens - DEFAULT_SAFETY_MARGIN;

    if (availableTokens <= 0) {
      if (spin) {
        spin.fail(
          `Prompt size (${totalInputTokens.toLocaleString()} tokens) exceeds the ${modelConfig.contextWindow.toLocaleString()}-token window of "${modelConfig.name}".\n` +
            'Reduce the number of files or switch to a larger-context model.',
        );
        spin.stop(); // Ensure cleanup
      }
      exitWithCode(EXIT_CODES.CONTEXT_TOO_LARGE);
    }

    if (availableTokens < modelConfig.contextWindow * 0.2) {
      if (spin) {
        spin.warn(
          `Large context: ${totalInputTokens.toLocaleString()} tokens. ` +
            `${availableTokens.toLocaleString()} tokens remain for the response.`,
        );
      }
    }

    // Determine web search setting
    // Default: enabled if model supports and user didn't disable it.
    const webSearchEnabled =
      options.webSearch !== undefined
        ? Boolean(options.webSearch)
        : Boolean(modelConfig.supportsWebSearch);
    
    // Parse cost threshold once and reuse
    const envThreshold = process.env.PROMPTCODE_COST_THRESHOLD;
    const resolvedCostThreshold = (() => {
      if (options.costThreshold !== undefined) return options.costThreshold;
      if (!envThreshold) return 0.50;
      const parsed = parseFloat(envThreshold);
      if (!Number.isFinite(parsed) || parsed < 0) {
        console.error(chalk.yellow(`Warning: Invalid PROMPTCODE_COST_THRESHOLD value "${envThreshold}". Using default $0.50.`));
        return 0.50;
      }
      return parsed;
    })();

    // Calculate estimated costs using total input tokens
    const expectedOutput = Math.min(availableTokens, DEFAULT_EXPECTED_COMPLETION);
    const estimatedTotalCost = estimateCost(modelKey, totalInputTokens, expectedOutput);
    const estimatedInputCost = (totalInputTokens / 1_000_000) * modelConfig.pricing.input;
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
            input: totalInputTokens,
            expectedOutput: expectedOutput,
            availableForOutput: availableTokens,
            total: totalInputTokens + expectedOutput
          },
          cost: {
            input: estimatedInputCost,
            output: estimatedOutputCost,
            total: estimatedTotalCost
          },
          fileCount: files.length,
          patterns: patterns.length > 0 ? patterns : undefined,
          preset: options.preset || undefined,
          webSearchEnabled: webSearchEnabled && modelConfig.supportsWebSearch,
          costThreshold: resolvedCostThreshold
        };
        console.log(JSON.stringify(costEstimate, null, 2));
      } else {
        // Human-readable output
        console.log(chalk.blue('\n📊 Cost Estimate (Dry Run):'));
        console.log(chalk.gray(`  Model:  ${modelConfig.name} (${modelKey})`));
        console.log(chalk.gray(`  Input:  ${totalInputTokens.toLocaleString()} tokens × $${modelConfig.pricing.input}/M = $${estimatedInputCost.toFixed(4)}`));
        console.log(chalk.gray(`  Output: ~${expectedOutput.toLocaleString()} tokens × $${modelConfig.pricing.output}/M = $${estimatedOutputCost.toFixed(4)}`));
        console.log(chalk.bold(`  Total:  ~$${estimatedTotalCost.toFixed(4)}`));
        console.log(chalk.gray(`\n  Files:  ${files.length} files included`));
        console.log(chalk.gray(`  Context: ${totalInputTokens.toLocaleString()}/${modelConfig.contextWindow.toLocaleString()} tokens used`));
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
      console.error(chalk.gray(`  Input:  ${totalInputTokens.toLocaleString()} tokens × $${modelConfig.pricing.input}/M = $${estimatedInputCost.toFixed(4)}`));
      console.error(chalk.gray(`  Output: ~${expectedOutput.toLocaleString()} tokens × $${modelConfig.pricing.output}/M = $${estimatedOutputCost.toFixed(4)}`));
      console.error(chalk.bold(`  Total:  ~$${estimatedTotalCost.toFixed(4)}`));
    }

    // Check if approval is needed
    const skipConfirm = shouldSkipConfirmation(options);
    const isExpensive = estimatedTotalCost > resolvedCostThreshold;
    
    if (!skipConfirm && isExpensive) {
      if (!isInteractive()) {
        const errorPayload = {
          error: 'Cost approval required',
          errorCode: 'APPROVAL_REQUIRED',
          estimatedCost: estimatedTotalCost,
          costThreshold: resolvedCostThreshold,
          message: 'Non-interactive environment detected. Use --yes to proceed without confirmation.'
        };
        
        if (options.json) {
          // Output JSON error to stdout for consistency with other JSON outputs
          console.log(JSON.stringify(errorPayload, null, 2));
        } else {
          // Output human-readable message to stderr
          console.error(chalk.yellow('\n⚠️  Cost approval required for expensive operation (~$' + estimatedTotalCost.toFixed(2) + ')'));
          console.error(chalk.yellow('Non-interactive environment detected.'));
          console.error(chalk.yellow('Use --yes to proceed with approval after getting user confirmation.'));
        }
        
        exitWithCode(EXIT_CODES.APPROVAL_REQUIRED);
      }
      
      console.log(chalk.yellow(`\n⚠️  This consultation will cost approximately $${estimatedTotalCost.toFixed(2)}`))
      
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
    
    // Show web search status and warnings (skip in JSON mode)
    if (!options.json) {
      if (webSearchEnabled && modelConfig.supportsWebSearch) {
        console.log(chalk.cyan('🔍 Web search enabled for current information\n'));
      } else if (options.webSearch === true && !modelConfig.supportsWebSearch) {
        // User explicitly requested web search but model doesn't support it
        console.log(chalk.yellow(`⚠️  ${modelConfig.name} does not support web search. Proceeding without web search.\n`));
      }
      // Warn if we auto-included a very large set
      if (!options.files?.length && !options.preset && files.length > 200) {
        console.log(chalk.yellow(`⚠️  Including ${files.length} files by default. Consider --preset or -f to narrow scope.`));
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
        webSearch: webSearchEnabled && modelConfig.supportsWebSearch,
        textVerbosity: options.verbosity,
        reasoningEffort: options.reasoningEffort,
        serviceTier: options.serviceTier,
      });
      console.log(); // Add newline after streaming
    } else {
      response = await aiProvider.generateText(modelKey, fullPrompt, {
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: availableTokens,
        webSearch: webSearchEnabled && modelConfig.supportsWebSearch,
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
        contextTokens: totalInputTokens,
        webSearchEnabled: webSearchEnabled && modelConfig.supportsWebSearch
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
        try {
          await fs.promises.writeFile(options.output, response.text);
          console.log(chalk.green(`\n✓ Saved response to ${options.output}`));
        } catch (writeError) {
          const err = writeError as NodeJS.ErrnoException;
          if (err.code === 'EACCES' || err.code === 'EPERM') {
            console.error(chalk.red(`\n❌ Permission denied: Cannot write to ${options.output}`));
            exitWithCode(EXIT_CODES.PERMISSION_DENIED);
          }
          throw writeError; // Re-throw for other errors
        }
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
      tokenCount: totalInputTokens,
      model: modelKey
    });
    
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
      exitWithCode(EXIT_CODES.GENERAL_ERROR);
    }
    
    if (spin) {
      spin.fail(chalk.red(`Error: ${err.message}`));
      spin.stop(); // Ensure cleanup
    } else {
      // Output error to stderr when no spinner
      console.error(chalk.red(`Error: ${err.message}`));
    }

    // Helpful message for context-length overflows
    const msg = err.message.toLowerCase();
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
    if (err.message.includes('API key')) {
      console.log(chalk.yellow('\nTo configure API keys:'));
      console.log('1. Set environment variables (any of these):');
      console.log('   export OPENAI_API_KEY="sk-..."        # or OPENAI_KEY');
      console.log('   export ANTHROPIC_API_KEY="sk-ant-..."  # or CLAUDE_API_KEY');
      console.log('   export GOOGLE_API_KEY="..."            # or GOOGLE_CLOUD_API_KEY, GEMINI_API_KEY');
      console.log('   export XAI_API_KEY="..."               # or GROK_API_KEY');
      exitWithCode(EXIT_CODES.MISSING_API_KEY);
      return; // This won't be reached but helps TypeScript
    }
    
    // Specific exit codes for network and permission errors
    if (typeof err.code === 'string') {
      const code = err.code.toUpperCase();
      if (code === 'EACCES' || code === 'EPERM') {
        exitWithCode(EXIT_CODES.PERMISSION_DENIED);
      }
      if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENETUNREACH') {
        exitWithCode(EXIT_CODES.NETWORK_ERROR);
      }
    }
    // HTTP-ish provider failures surfaced as messages
    const m = String(err.message).toLowerCase();
    
    // Check for specific HTTP status codes
    const statusMatch = err.message.match(/\b(429|5\d{2})\b/);
    if (statusMatch) {
      exitWithCode(EXIT_CODES.NETWORK_ERROR);
    }
    
    // Check for timeout errors
    if (m.includes('timeout') || m.includes('etimedout') || m.includes('econnaborted')) {
      exitWithCode(EXIT_CODES.NETWORK_ERROR);
    }
    exitWithCode(EXIT_CODES.GENERAL_ERROR);
  }
}