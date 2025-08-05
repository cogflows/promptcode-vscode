import * as fs from 'fs';
import chalk from 'chalk';
import { estimateCostsForAllModels } from './cost';

export interface OutputOptions {
  json?: boolean;
  out?: string;
}

/**
 * Output JSON result to file or console
 */
export async function outputJson(data: any, options: OutputOptions): Promise<void> {
  const jsonString = JSON.stringify(data, null, 2);
  
  if (options.out) {
    await fs.promises.writeFile(options.out, jsonString);
    if (!options.json) {
      console.log(chalk.green(`✓ Saved JSON output to ${options.out}`));
    }
  } else {
    console.log(jsonString);
  }
}

/**
 * Output text result to file or console
 */
export async function outputText(
  text: string, 
  options: OutputOptions,
  metadata?: { tokenCount?: number; fileCount?: number }
): Promise<void> {
  if (options.out) {
    await fs.promises.writeFile(options.out, text);
    console.log(chalk.green(`✓ Saved prompt to ${options.out}`));
    
    if (metadata?.tokenCount) {
      console.log(chalk.gray(`  Token count: ${metadata.tokenCount}`));
    }
    if (metadata?.fileCount) {
      console.log(chalk.gray(`  Files included: ${metadata.fileCount}`));
    }
  } else {
    console.log(text);
    
    // Add helpful tip for large outputs
    if (!options.json && metadata?.fileCount && metadata.fileCount > 5) {
      console.error(chalk.gray('\nTip: Consider saving large outputs with -o .promptcode/outputs/<name>.md'));
    }
  }
}

/**
 * Output prompt generation results
 */
export async function outputResults(result: any, selectedFiles: any[], options: OutputOptions): Promise<void> {
  if (options.json) {
    const costs = estimateCostsForAllModels(result.tokenCount);
    const jsonOutput = {
      prompt: result.prompt,
      tokenCount: result.tokenCount,
      sections: result.sections,
      estimatedCosts: {
        note: "Costs in USD for ~4K output tokens",
        ...costs
      },
      files: selectedFiles.map((f: any) => ({
        path: f.path,
        tokens: f.tokenCount
      }))
    };
    await outputJson(jsonOutput, options);
  } else {
    await outputText(result.prompt, options, {
      tokenCount: result.tokenCount,
      fileCount: selectedFiles.length
    });
  }
}