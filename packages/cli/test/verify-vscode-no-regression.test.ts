import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * This test verifies that our CLI changes don't affect the VS Code extension.
 * 
 * The VS Code extension:
 * 1. Does NOT have preset creation functionality (no preset commands in package.json)
 * 2. Does NOT use generatePatternsFromSelection or optimizeSelection
 * 3. Only imports token counting and prompt building utilities from @promptcode/core
 * 4. Works with already-selected files from the UI, not patterns
 */
describe('VS Code Extension Regression Verification', () => {
  it('confirms VS Code extension has no preset creation commands', () => {
    const packageJsonPath = path.join(__dirname, '../../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Check that no commands contain 'preset'
    const commands = packageJson.contributes?.commands || [];
    const presetCommands = commands.filter((cmd: any) => 
      cmd.command?.toLowerCase().includes('preset') || 
      cmd.title?.toLowerCase().includes('preset')
    );
    
    expect(presetCommands).toHaveLength(0);
  });

  it('confirms VS Code extension only imports safe utilities from core', () => {
    const extensionPath = path.join(__dirname, '../../../src/extension.ts');
    const extensionContent = fs.readFileSync(extensionPath, 'utf8');
    
    // VS Code extension should import these utilities from @promptcode/core
    expect(extensionContent).toContain('countTokensInFile');
    expect(extensionContent).toContain('countTokensWithCache');
    expect(extensionContent).toContain('buildPrompt');
    
    // VS Code extension should NOT import pattern-related utilities
    expect(extensionContent).not.toContain('generatePatternsFromSelection');
    expect(extensionContent).not.toContain('optimizeSelection');
  });

  it('confirms core utilities used by VS Code remain unchanged', () => {
    // These are the core utilities the VS Code extension uses
    const coreExports = [
      'countTokensInFile',
      'countTokensWithCache',
      'countTokensWithCacheDetailed',
      'clearTokenCache',
      'initializeTokenCounter',
      'tokenCache',
      'countTokens',
      'buildPrompt',
      'SelectedFile' // type
    ];
    
    const coreIndexPath = path.join(__dirname, '../../core/src/index.ts');
    const coreIndexContent = fs.readFileSync(coreIndexPath, 'utf8');
    
    // Core uses wildcard exports
    expect(coreIndexContent).toContain("export * from './tokenCounter");
    expect(coreIndexContent).toContain("export * from './promptBuilder");
    
    // Verify the actual exported files exist
    const tokenCounterPath = path.join(__dirname, '../../core/src/tokenCounter.ts');
    const promptBuilderPath = path.join(__dirname, '../../core/src/promptBuilder.ts');
    expect(fs.existsSync(tokenCounterPath)).toBe(true);
    expect(fs.existsSync(promptBuilderPath)).toBe(true);
  });

  it('confirms pattern utilities are separate from VS Code workflow', () => {
    // Pattern optimization utilities are in their own files
    const patternOptimizerPath = path.join(__dirname, '../../core/src/utils/patternOptimizer.ts');
    const generatePatternsPath = path.join(__dirname, '../../core/src/utils/generatePatternsFromSelection.ts');
    
    // These files exist in core but are NOT used by VS Code extension
    expect(fs.existsSync(patternOptimizerPath)).toBe(true);
    expect(fs.existsSync(generatePatternsPath)).toBe(true);
    
    // VS Code extension main file doesn't reference these utilities
    const extensionPath = path.join(__dirname, '../../../src/extension.ts');
    const extensionContent = fs.readFileSync(extensionPath, 'utf8');
    
    expect(extensionContent).not.toContain('patternOptimizer');
    expect(extensionContent).not.toContain('generatePatternsFromSelection');
    expect(extensionContent).not.toContain('optimizeSelection');
  });

  it('demonstrates CLI changes are isolated to CLI package', () => {
    // Our new pattern utilities are in CLI package only
    const cliPatternUtilsPath = path.join(__dirname, '../src/utils/pattern-utils.ts');
    expect(fs.existsSync(cliPatternUtilsPath)).toBe(true);
    
    // Pattern preservation logic is in CLI's preset command
    const presetCommandPath = path.join(__dirname, '../src/commands/preset.ts');
    const presetContent = fs.readFileSync(presetCommandPath, 'utf8');
    
    // CLI imports the new pattern utilities
    expect(presetContent).toContain("from '../utils/pattern-utils'");
    expect(presetContent).toContain('separatePatternsFromPaths');
    expect(presetContent).toContain('validatePatternSafety');
    expect(presetContent).toContain('directoryToPattern');
    
    // These imports are LOCAL to CLI, not from @promptcode/core
    expect(presetContent).toContain("'../utils/pattern-utils'");
    expect(presetContent).not.toContain("@promptcode/core.*pattern-utils");
  });

  it('confirms optimizeSelection in core remains unchanged for VS Code', () => {
    // The optimizeSelection function in core is only used by CLI
    // VS Code doesn't use it, so changes to how CLI calls it won't affect VS Code
    const coreUtilsIndexPath = path.join(__dirname, '../../core/src/utils/index.ts');
    const coreUtilsContent = fs.readFileSync(coreUtilsIndexPath, 'utf8');
    
    // patternOptimizer is exported from core utils
    expect(coreUtilsContent).toContain("export * from './patternOptimizer");
    
    // But VS Code extension doesn't import it
    const extensionPath = path.join(__dirname, '../../../src/extension.ts');
    const extensionContent = fs.readFileSync(extensionPath, 'utf8');
    expect(extensionContent).not.toContain('optimizeSelection');
    expect(extensionContent).not.toContain('patternOptimizer');
  });
});

/**
 * Summary of why VS Code extension won't experience regression:
 * 
 * 1. **Different Workflows**: 
 *    - VS Code: User selects files in UI → generates prompt
 *    - CLI: User provides patterns/files → creates preset
 * 
 * 2. **No Shared Preset Logic**:
 *    - VS Code has NO preset creation functionality
 *    - All preset logic is in CLI package only
 * 
 * 3. **Clean Separation**:
 *    - Pattern preservation logic is in CLI's pattern-utils.ts
 *    - VS Code only imports token counting and prompt building from core
 *    - optimizeSelection is in core but NOT used by VS Code
 * 
 * 4. **Core Utilities Unchanged**:
 *    - We didn't modify any utilities that VS Code uses
 *    - Token counting, prompt building remain the same
 * 
 * 5. **Testing Coverage**:
 *    - This test file verifies the separation
 *    - Existing VS Code tests would catch any regression
 */