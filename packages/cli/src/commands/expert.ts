import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { scanFiles, buildPrompt, initializeTokenCounter } from '@promptcode/core';

interface ExpertOptions {
  path?: string;
  preset?: string;
  files?: string[];
  model?: string;
  output?: string;
  stream?: boolean;
}

/**
 * Load OpenAI API key from environment or config
 */
function getApiKey(): string {
  // Check environment variable first
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  
  // Check config file
  const configPath = path.join(process.env.HOME || '', '.config', 'promptcode', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.openaiApiKey) {
        return config.openaiApiKey;
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  throw new Error('OpenAI API key not found. Set OPENAI_API_KEY environment variable or run: promptcode config --set-openai-key');
}

/**
 * Call OpenAI API
 */
async function callOpenAI(
  question: string, 
  context: string, 
  model: string,
  stream: boolean
): Promise<string> {
  const apiKey = getApiKey();
  
  const messages = [
    {
      role: 'system',
      content: 'You are an expert software engineer helping analyze and improve code. Be concise and specific in your responses.'
    },
    {
      role: 'user',
      content: `Here is the codebase context:\n\n${context}\n\n${question}`
    }
  ];
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      stream
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }
  
  if (stream) {
    // Handle streaming response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let result = '';
    
    if (!reader) throw new Error('No response body');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              process.stdout.write(content);
              result += content;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
    
    return result;
  } else {
    const data = await response.json();
    return data.choices[0].message.content;
  }
}

/**
 * Expert consultation command
 */
export async function expertCommand(question: string, options: ExpertOptions): Promise<void> {
  const spinner = !options.stream ? ora('Preparing context...').start() : null;
  
  try {
    // Initialize token counter
    const cacheDir = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '', '.cache', 'promptcode');
    initializeTokenCounter(cacheDir, '0.1.0');
    
    const projectPath = path.resolve(options.path || process.cwd());
    
    // Determine patterns
    let patterns: string[] = options.files || ['**/*'];
    
    if (options.preset) {
      // Load preset
      const presetPath = path.join(projectPath, '.promptcode', 'presets', `${options.preset}.patterns`);
      if (fs.existsSync(presetPath)) {
        const content = await fs.promises.readFile(presetPath, 'utf8');
        patterns = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
      } else {
        throw new Error(`Preset not found: ${options.preset}`);
      }
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
      return;
    }
    
    // Build context
    const result = await buildPrompt(files, '', {
      includeFiles: true,
      includeInstructions: false,
      includeFileContents: true
    });
    
    const model = options.model || 'gpt-4-turbo-preview';
    const tokenLimit = model.includes('gpt-4') ? 128000 : 16000;
    
    if (result.tokenCount > tokenLimit * 0.8) {
      spinner?.warn(`Context is large (${result.tokenCount} tokens). Consider using a preset to reduce scope.`);
    }
    
    if (spinner) {
      spinner.text = `Consulting ${model}...`;
    }
    
    // Call OpenAI
    const answer = await callOpenAI(question, result.prompt, model, options.stream || false);
    
    if (!options.stream) {
      spinner?.succeed('Expert consultation complete');
      console.log('\n' + answer);
    } else {
      // Add newline after streaming completes to ensure proper terminal state
      console.log();
    }
    
    // Save output if requested
    if (options.output) {
      await fs.promises.writeFile(options.output, answer);
      console.log(chalk.green(`\n✓ Saved response to ${options.output}`));
    }
    
    // Show token usage estimate
    const estimatedCost = (result.tokenCount / 1000) * 0.01 + (answer.length / 4000) * 0.03;
    console.log(chalk.gray(`\nEstimated cost: ~$${estimatedCost.toFixed(3)}`));
    
  } catch (error) {
    spinner?.fail(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}