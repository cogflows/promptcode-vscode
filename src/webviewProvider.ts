/* PromptCode - Copyright (C) 2025. All Rights Reserved. */

import * as vscode from 'vscode';
import * as path from 'path';
import { loadPrompts, loadConfiguredPrompts, Prompt } from './promptLoader';
import { getSelectFilesTabHtml } from './webview/tabs/selectFilesTabContent';
import { getInstructionsTabHtml } from './webview/tabs/instructionsTabContent';
import { getPromptTabHtml } from './webview/tabs/promptTabContent';
import { getMergeTabHtml } from './webview/tabs/mergeTabContent';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';

// --- Save to file feature ---
import { SAVE_PROMPT_TO_FILE } from './constants';
import { savePromptToFile, getLastGeneratedPrompt, fileExplorerProvider, checkedItems } from './extension';
import { loadPresets, savePreset, savePatternPreset } from './presetManager';
import { generatePatternsFromSelection } from './utils/generatePatternsFromSelection';
import { listFilesByPatternsFile } from './utils/filePattern';
// --- End Save to file feature ---

// --- File Preset Commands ---
import {
    SAVE_FILE_PRESET,
    APPLY_FILE_PRESET,
    REQUEST_FILE_PRESETS,
    UPDATE_FILE_PRESETS
} from './constants';
// --- End File Preset Commands ---

export class PromptCodeWebViewProvider {
    public static readonly viewType = 'promptcode.webview';
    public _panel: vscode.WebviewPanel | undefined;
    private readonly packageVersion: string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext
    ) {
        this.packageVersion = this._extensionContext.extension.packageJSON.version;
    }

    public async showWebView() {
        if (this._panel) {
            // Make visible if it exists but is hidden
            this._panel.reveal(vscode.ViewColumn.One);
            
            // Also refresh selected files to ensure state consistency
            setTimeout(() => {
                if (this._panel && this._panel.visible) {
                    console.log('Refreshing selected files after panel reveal');
                    vscode.commands.executeCommand('promptcode.getSelectedFiles');
                }
            }, 100);
            return;
        }

        const prompts = await loadConfiguredPrompts(this._extensionContext, true, []);

        this._panel = vscode.window.createWebviewPanel(
            PromptCodeWebViewProvider.viewType,
            'PromptCode',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, prompts);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                console.log('WebView message received:', message);

                // --- Helper to get workspace root ---
                const getWorkspaceRoot = (): string | undefined => {
                    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    if (!root) {
                        console.error("No workspace folder found.");
                        vscode.window.showErrorMessage("No workspace folder open.");
                    }
                    return root;
                };
                // --- End Helper ---

                switch (message.command) {
                    case 'search':
                        console.log('Search command received in webview provider, searchTerm:', message.searchTerm);
                        Promise.resolve(vscode.commands.executeCommand('promptcode.filterFiles', message.searchTerm))
                            .then(() => {
                                console.log("Search filtering complete");
                            })
                            .catch((error: Error) => {
                                console.error("Error in search filtering:", error);
                            });
                        return;
                    case 'expandAll':
                        console.log('ExpandAll command received in webview provider');
                        vscode.commands.executeCommand('promptcode.expandAll');
                        return;
                    case 'collapseAll':
                        console.log('CollapseAll command received in webview provider');
                        vscode.commands.executeCommand('promptcode.collapseAll');
                        return;
                    case 'selectAll':
                        console.log('SelectAll command received in webview provider');
                        vscode.commands.executeCommand('promptcode.selectAll');
                        return;
                    case 'deselectAll':
                        console.log('DeselectAll command received in webview provider');
                        vscode.commands.executeCommand('promptcode.deselectAll');
                        return;
                    case 'openPrompt':
                        console.log('OpenPrompt command received in webview provider');
                        vscode.commands.executeCommand('promptcode.generatePrompt');
                        return;
                    case 'copyPrompt':
                        console.log('CopyPrompt command received in webview provider');
                        vscode.commands.executeCommand('promptcode.copyPromptDirectly');
                        return;
                    case 'saveIgnoreConfig':
                        console.log('SaveIgnoreConfig command received in webview provider');
                        vscode.commands.executeCommand('promptcode.saveIgnoreConfig', message.ignorePatterns, message.respectGitignore);
                        return;
                    case 'loadIgnoreConfig':
                        console.log('LoadIgnoreConfig command received in webview provider');
                        vscode.commands.executeCommand('promptcode.loadIgnoreConfig');
                        return;
                    case 'savePromptsConfig':
                        console.log('SavePromptsConfig command received in webview provider');
                        vscode.commands.executeCommand('promptcode.savePromptsConfig', message.promptFolders, message.includeBuiltInTemplates);
                        return;
                    case 'loadPromptsConfig':
                        console.log('LoadPromptsConfig command received in webview provider');
                        vscode.commands.executeCommand('promptcode.loadPromptsConfig');
                        return;
                    case 'getSelectedFiles':
                        console.log('GetSelectedFiles command received in webview provider');
                        vscode.commands.executeCommand('promptcode.getSelectedFiles');
                        return;
                    case 'deselectFile':
                        console.log(`WebView wants to deselect file: ${message.filePath}`);
                        vscode.commands.executeCommand('promptcode.deselectFile', message.filePath, message.workspaceFolderRootPath);
                        break;
                    case 'removeDirectory':
                        console.log('RemoveDirectory command received in webview provider with path:', message.dirPath, 'workspace folder:', message.workspaceFolderName);
                        vscode.commands.executeCommand('promptcode.removeDirectory', message.dirPath, message.workspaceFolderName);
                        return;
                    case 'openFile':
                        console.log(`WebView wants to open file: ${message.filePath}`);
                        vscode.commands.executeCommand('promptcode.openFileInEditor', message.filePath, message.workspaceFolderRootPath);
                        break;
                    case 'clearTokenCache':
                        console.log('ClearTokenCache command received in webview provider');
                        const { clearTokenCache } = require('./tokenCounter');
                        clearTokenCache();
                        vscode.window.showInformationMessage('Token cache cleared successfully');
                        return;
                    case 'refreshFileExplorer':
                        console.log('RefreshFileExplorer command received in webview provider');
                        vscode.commands.executeCommand('promptcode.refreshFileExplorer');
                        return;
                    case 'debugRefreshSelectedFiles':
                        console.log('Debug: Manually refreshing selected files');
                        vscode.commands.executeCommand('promptcode.getSelectedFiles');
                        return;
                    case 'tabChanged':
                        console.log('Tab changed:', message.tabId);
                        return;
                    case 'generatePromptPreview':
                        console.log('Calling Generate prompt preview with options:', message.includeOptions, 'action:', message.action || 'none', 'source:', message.source || 'unknown');
                        const promptPreviewParams = {
                            includeOptions: message.includeOptions,
                            action: message.action,
                            source: message.source || 'unknown'
                        };
                        vscode.commands.executeCommand('promptcode.generatePromptPreview', promptPreviewParams);
                        return;
                    case 'saveInstructions':
                        console.log('Save instructions:', message.instructions);
                        this._extensionContext.workspaceState.update('promptcode.instructions', message.instructions);
                        return;
                    case 'loadInstructions':
                        console.log('Load instructions requested');
                        const savedInstructions = this._extensionContext.workspaceState.get('promptcode.instructions', '');
                        if (this._panel) {
                            this._panel.webview.postMessage({
                                command: 'updateInstructions',
                                instructions: savedInstructions
                            });
                        }
                        return;
                    case 'console':
                        const prefix = '[Webview]';
                        if (message.type === 'error') {
                            console.error(prefix, message.message);
                        } else if (message.type === 'warn') {
                            console.warn(prefix, message.message);
                        } else {
                            console.log(prefix, message.message);
                        }
                        return;
                    case 'copyPath':
                        console.log('Copy path command received with path:', message.filePath);
                        const copyPathWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                        if (copyPathWorkspaceRoot) {
                            const absolutePath = path.join(copyPathWorkspaceRoot, message.filePath);
                            vscode.env.clipboard.writeText(absolutePath);
                            vscode.window.showInformationMessage(`Copied absolute path to clipboard: ${absolutePath}`);
                        }
                        return;
                    case 'copyRelativePath':
                        console.log('Copy relative path command received with path:', message.filePath);
                        vscode.env.clipboard.writeText(message.filePath);
                        vscode.window.showInformationMessage(`Copied relative path to clipboard: ${message.filePath}`);
                        return;
                    case 'requestPrompts':
                        console.log('Request prompts command received');
                        const includeBuiltIn = message.includeBuiltInTemplates !== undefined ? 
                            message.includeBuiltInTemplates : true;
                        
                        // Parse folder paths
                        const folderPaths = message.promptFolders ? 
                            message.promptFolders.split('\n').map((f: string) => f.trim()).filter(Boolean) : 
                            [];
                            
                        this.sendPrompts(includeBuiltIn, folderPaths);
                        return;
                    case 'openPromptFile':
                        console.log('OpenPromptFile command received with prompt name:', message.promptName);
                        this.openPromptFile(message.promptName, message.filePath);
                        return;
                    case 'updateMergeContent':
                        console.log('Update Merge Content command received in webview provider');
                        vscode.commands.executeCommand('promptcode.updateMergeContent', message.content);
                        return;
                    case 'applyMerge':
                        console.log('Apply Merge command received in webview provider', message);
                        vscode.commands.executeCommand('promptcode.applyMerge', message.content);
                        return;
                    case 'replaceCode':
                        console.log('Replace Code command received in webview provider', message);
                        vscode.commands.executeCommand('promptcode.replaceCode', message);
                        return;
                    case 'showNewContent':
                        console.log('ShowNewContent command received in webview provider with path:', message.filePath);
                        vscode.commands.executeCommand('promptcode.showNewContent', message);
                        return;
                    case 'showDiff':
                        console.log('ShowDiff command received in webview provider with path:', message.filePath);
                        vscode.commands.executeCommand('promptcode.showDiff', message);
                        return;
                    case 'codeReplaced':
                        console.log('Code Replaced message received in webview provider', message);
                        // Forward the message back to the webview
                        if (this._panel) {
                            console.log('Forwarding codeReplaced message to webview:', message);
                            this._panel.webview.postMessage(message);
                        }
                        return;
                    case 'loadFileRequest':
                        console.log('LoadFileRequest command received in webview provider');
                        vscode.commands.executeCommand('promptcode.loadAndProcessFileList');
                        return;
                    case 'getHelpContentRequest':
                        console.log('GetHelpContentRequest command received in webview provider');
                        // Ensure we have a full Promise to chain .catch reliably
                        Promise.resolve(vscode.commands.executeCommand<string>('promptcode.getHelpContent'))
                            .then(content => {
                                if (this._panel && this._panel.webview) {
                                    this._panel.webview.postMessage({
                                        command: 'updateHelpContent',
                                        content: content || 'Error loading help content.' // Provide fallback
                                    });
                                }
                            })
                            .catch((error: unknown) => { // Explicitly type error
                                console.error('Error executing getHelpContent command:', error);
                                let errorMessage = 'Error loading help content.';
                                if (error instanceof Error) {
                                    errorMessage = `Error loading help content: ${error.message}`;
                                }
                                if (this._panel && this._panel.webview) {
                                    this._panel.webview.postMessage({
                                        command: 'updateHelpContent',
                                        content: errorMessage
                                    });
                                }
                            });
                        return;
                    case 'processPastedFileList':
                        console.log('ProcessPastedFileList command received in webview provider');
                        vscode.commands.executeCommand('promptcode.processPastedFileList', message.content);
                        return;
                    case SAVE_PROMPT_TO_FILE:
                        console.log('SavePromptToFile received in webview provider');
                        // Use an async IIFE to handle await within the message handler
                        (async () => {
                            let textToSave = message.promptText as string | undefined;
                            // Use getter and handle null case by defaulting to undefined
                            const cachedPrompt = getLastGeneratedPrompt() ?? undefined;

                            // Fallback 1: Use lastGeneratedPrompt if webview sent nothing
                            if (!textToSave && cachedPrompt) {
                                textToSave = cachedPrompt;
                                console.log('Using cached lastGeneratedPrompt for saving.');
                            }

                            // Fallback 2: Generate on-demand if still nothing
                            // Note: This assumes generatePromptPreview updates lastGeneratedPrompt
                            if (!textToSave) {
                                console.log('No text provided or cached, attempting to generate prompt before saving...');
                                try {
                                    // Get last used include options
                                    const lastIncludeOptions = this._extensionContext.workspaceState.get('promptcode.includeOptions');
                                    if (!lastIncludeOptions) {
                                        throw new Error('Cannot regenerate prompt: Include options not found in workspace state.');
                                    }
                                    // Execute the command and wait for it to update lastGeneratedPrompt
                                    await vscode.commands.executeCommand('promptcode.generatePromptPreview', { includeOptions: lastIncludeOptions });
                                    // Now check the cache again using the getter, defaulting null to undefined
                                    textToSave = getLastGeneratedPrompt() ?? undefined;
                                    if (textToSave) {
                                        console.log('Successfully generated and cached prompt for saving.');
                                    } else {
                                        throw new Error('Failed to regenerate prompt for saving.');
                                    }
                                } catch (genError) {
                                    console.error('Error regenerating prompt for saving:', genError);
                                    vscode.window.showErrorMessage(`Could not save prompt: Failed to regenerate text (${genError instanceof Error ? genError.message : String(genError)})`);
                                    return; // Stop if regeneration failed
                                }
                            }

                            // Proceed with saving if we have text
                            if (textToSave) {
                                savePromptToFile(textToSave).catch((error: Error) => {
                                    console.error('Error saving prompt to file:', error);
                                    vscode.window.showErrorMessage(`Failed to save prompt: ${error.message}`);
                                });
                            } else {
                                // This path should ideally not be reached if fallbacks work
                                console.warn('SavePromptToFile failed: Text was not available even after fallbacks.');
                                vscode.window.showErrorMessage('Could not save prompt: Text was not available.');
                            }
                        })(); // Immediately invoke the async function
                        return;
                    case REQUEST_FILE_PRESETS: {
                        console.log('REQUEST_FILE_PRESETS command received');
                        const root = getWorkspaceRoot();
                        if (!root || !this._panel) return;
                        const presets = loadPresets(root);
                        this._panel.webview.postMessage({ command: UPDATE_FILE_PRESETS, presets });
                        return;
                    }
                    case SAVE_FILE_PRESET: {
                        console.log('SAVE_FILE_PRESET command received with options:', message);
                        const { presetName, currentPreset, useSaveDialog } = message;
                        const root = getWorkspaceRoot();
                        if (!root || !this._panel) return;

                        // Ensure fileExplorerProvider is available
                        if (!fileExplorerProvider || typeof fileExplorerProvider.getSelectedPaths !== 'function') {
                            console.error("fileExplorerProvider or getSelectedPaths method is not available.");
                            vscode.window.showErrorMessage("Error saving preset: File selection provider is not ready.");
                            return;
                        }

                        // Get correctly resolved relative paths from the provider
                        const relativePaths = fileExplorerProvider.getSelectedPaths();
                        if (relativePaths.length === 0) {
                            vscode.window.showWarningMessage("No files selected. Please select files before saving a preset.");
                            return;
                        }
                        
                        // Handle cases using native save dialog
                        if (useSaveDialog) {
                            (async () => {
                                try {
                                    // Prepare preset directory
                                    const presetsDir = path.join(root, '.promptcode/presets');
                                    if (!fs.existsSync(presetsDir)) {
                                        fs.mkdirSync(presetsDir, { recursive: true });
                                    }
                                    
                                    // Set default file name based on current selection or suggested name
                                    let defaultFileName = 'my-preset.patterns';
                                    if (currentPreset) {
                                        // Use the selected preset name if one is selected
                                        defaultFileName = currentPreset.replace(/[/\\?%*:|"<>]/g, '-')
                                            .replace(/\s+/g, '_').toLowerCase() + '.patterns';
                                    }
                                    
                                    // Create URI for default save location
                                    const defaultUri = vscode.Uri.file(path.join(presetsDir, defaultFileName));
                                    
                                    // Show save dialog
                                    const saveDialogOptions = {
                                        defaultUri,
                                        filters: {
                                            'Pattern Files': ['patterns']
                                        },
                                        title: 'Save File Preset',
                                        saveLabel: 'Save Preset'
                                    };
                                    
                                    const fileUri = await vscode.window.showSaveDialog(saveDialogOptions);
                                    if (!fileUri) {
                                        console.log('User cancelled the save dialog');
                                        return; // User cancelled
                                    }
                                    
                                    // Extract name from selected path (remove extension and directory)
                                    const selectedPath = fileUri.fsPath;
                                    const fileName = path.basename(selectedPath, '.patterns');
                                    const presetName = fileName;
                                    
                                    // Generate patterns from the selected files
                                    const patterns = generatePatternsFromSelection(relativePaths, root);
                                    
                                    // Write patterns to the selected file
                                    const content = patterns.join('\n') + '\n'; // Add trailing newline
                                    fs.writeFileSync(selectedPath, content, 'utf8');
                                    console.log(`Saved pattern preset "${presetName}" to ${selectedPath}`);
                                    
                                    // Reload and update UI
                                    const currentPresets = loadPresets(root);
                                    if (this._panel) {
                                        // Update presets list and select the newly saved preset
                                        this._panel.webview.postMessage({ 
                                            command: UPDATE_FILE_PRESETS, 
                                            presets: currentPresets,
                                            selectPreset: presetName // Tell frontend to select this preset
                                        });
                                    }
                                    
                                    // Show success message
                                    vscode.window.showInformationMessage(`Preset "${presetName}" saved successfully.`);
                                } catch (error) {
                                    console.error('Error saving preset with dialog:', error);
                                    vscode.window.showErrorMessage(`Failed to save preset: ${error instanceof Error ? error.message : String(error)}`);
                                }
                            })();
                            return;
                        }
                        
                        // Traditional save without dialog (legacy path)
                        if (!presetName) {
                            vscode.window.showErrorMessage("No preset name provided for saving.");
                            return;
                        }
                        
                        const currentPresets = loadPresets(root);
                        const existingPresetIndex = currentPresets.findIndex(p => p.name === presetName);
                        
                        console.log(`Saving preset '${presetName}' with ${relativePaths.length} files.`);

                        if (existingPresetIndex > -1) {
                            // Preset with the same name exists
                            const overwrite = await vscode.window.showWarningMessage(
                                `Preset "${presetName}" already exists. Overwrite?`,
                                { modal: true },
                                'Overwrite'
                            );
                            if (overwrite !== 'Overwrite') {
                                return; // User cancelled
                            }
                        }
                        
                        // Generate patterns from the selected files
                        const patterns = generatePatternsFromSelection(relativePaths, root);
                        
                        // Save the preset in the new pattern format
                        savePatternPreset(root, presetName, patterns);
                        
                        // Create updatedPreset object for UI
                        const updatedPreset = { 
                            name: presetName, 
                            patternFile: path.join(root, '.promptcode/presets', `${presetName.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_').toLowerCase()}.patterns`)
                        };
                        
                        // Update UI with the new list of presets
                        if (existingPresetIndex > -1) {
                            // Replace existing preset
                            currentPresets[existingPresetIndex] = updatedPreset;
                        } else {
                            // Add new preset
                            currentPresets.push(updatedPreset);
                        }
                        
                        this._panel.webview.postMessage({ 
                            command: UPDATE_FILE_PRESETS, 
                            presets: currentPresets,
                            selectPreset: presetName // Tell frontend to select this preset
                        });
                        
                        // Confirm the save
                        vscode.window.showInformationMessage(`Preset "${presetName}" saved successfully.`);
                        return;
                    }
                    case APPLY_FILE_PRESET: {
                        console.log('APPLY_FILE_PRESET command received with name:', message.presetName);
                        const { presetName } = message;
                        const root = getWorkspaceRoot();
                        if (!root || !presetName) return;

                        const preset = loadPresets(root).find(p => p.name === presetName);
                        if (!preset) {
                            vscode.window.showWarningMessage(`Preset "${presetName}" not found.`);
                            return;
                        }

                        // Ensure fileExplorerProvider and its selectFiles method are available
                        if (!fileExplorerProvider || typeof fileExplorerProvider.selectFiles !== 'function') {
                             console.error("fileExplorerProvider or selectFiles method is not available.");
                             vscode.window.showErrorMessage("Error applying preset: File selection provider is not ready.");
                             return;
                        }

                        try {
                            let filesToSelect: string[];
                            
                            if (preset.patternFile) {
                                // New pattern-based preset
                                filesToSelect = await listFilesByPatternsFile(preset.patternFile, root);
                            } else if (preset.files) {
                                // Legacy JSON preset
                                filesToSelect = preset.files;
                            } else {
                                vscode.window.showErrorMessage(`Preset "${presetName}" has no files or patterns.`);
                                return;
                            }
                            
                            await fileExplorerProvider.selectFiles(filesToSelect);
                            console.log(`Applied preset "${presetName}" successfully.`);
                            // Optionally, notify the webview or refresh parts of it if needed after applying
                            // this._panel?.webview.postMessage({ command: 'presetApplied', presetName });
                        } catch (error) {
                            console.error(`Error applying preset "${presetName}":`, error);
                            vscode.window.showErrorMessage(`Failed to apply preset "${presetName}": ${error instanceof Error ? error.message : String(error)}`);
                        }
                        return;
                    }
                }
            },
            undefined,
            []
        );

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        }, null, []);
    }

    public closeWebView() {
        if (this._panel) {
            this._panel.dispose();
            this._panel = undefined;
        }
    }

    private async sendPrompts(includeBuiltInTemplates = true, promptFolderPaths: string[] = []) {
        if (!this._panel) {
            return;
        }

        try {
            // Always use loadConfiguredPrompts to include data repo prompts
            console.log(`Loading configured prompts with includeBuiltIn: ${includeBuiltInTemplates}, folders: ${promptFolderPaths.join(', ')}`);
            const allPrompts = await loadConfiguredPrompts(
                this._extensionContext,
                includeBuiltInTemplates,
                promptFolderPaths
            );
            console.log(`Loaded ${allPrompts.length} prompts in total.`);
            
            this._panel.webview.postMessage({
                command: 'updatePrompts',
                prompts: allPrompts
            });
        } catch (error) {
            console.error('Error sending prompts to webview:', error);
            vscode.window.showErrorMessage(`Failed to load prompts: ${(error as Error).message}`);
        }
    }

    /**
     * Opens a prompt file in the editor
     * @param promptName The name of the prompt to open
     * @param filePath Optional file path of the prompt
     */
    private async openPromptFile(promptName: string, filePath?: string) {
        try {
            // If a file path is provided, try to open it directly
            if (filePath && !filePath.startsWith('http')) {
                try {
                    const fileUri = vscode.Uri.file(filePath);
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    await vscode.window.showTextDocument(doc);
                    return;
                } catch (error) {
                    console.error(`Failed to open file at path ${filePath}, falling back to name-based lookup`);
                    // Fall through to traditional lookup only if it wasn't an HTTP path initially
                }
            } else if (filePath && filePath.startsWith('http')) {
                // Handle HTTP paths: Fetch, save to temp, and open
                console.log(`Fetching remote prompt '${promptName}' from ${filePath}`);
                try {
                    const content = await new Promise<string>((resolve, reject) => {
                        https.get(filePath!, (res) => { // Use the guaranteed non-null filePath
                            let data = '';
                            res.on('data', (chunk) => { data += chunk; });
                            res.on('end', () => {
                                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                                    resolve(data);
                                } else {
                                    reject(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
                                }
                            });
                        }).on('error', (err) => {
                            reject(err);
                        });
                    });

                    // Sanitize promptName for use in filename
                    const safePromptName = promptName.replace(/[^a-z0-9_-]/gi, '_').substring(0, 50);
                    const tempFileName = `promptcode-remote-${safePromptName}-${Date.now()}.txt`;
                    const tempFilePath = path.join(os.tmpdir(), tempFileName);
                    const tempFileUri = vscode.Uri.file(tempFilePath);

                    await fs.promises.writeFile(tempFilePath, content, 'utf8');
                    console.log(`Saved remote prompt content to temporary file: ${tempFilePath}`);

                    const doc = await vscode.workspace.openTextDocument(tempFileUri);
                    await vscode.window.showTextDocument(doc, { preview: false }); // Open non-preview
                    vscode.window.showInformationMessage(`Opened remote prompt '${promptName}' content in a temporary file.`);

                } catch (fetchErr) {
                    console.error(`Failed to fetch or open remote prompt '${promptName}' from ${filePath}:`, fetchErr);
                    vscode.window.showErrorMessage(`Could not open remote prompt '${promptName}'. Failed to fetch content: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
                }
                return; // Stop processing after handling HTTP
            }

            // First check built-in prompts (may be read-only)
            const builtInPrompts = await loadPrompts(this._extensionContext);
            const builtInPrompt = builtInPrompts.find(p => p.name === promptName);
            
            // Then check user prompts (load specifically, don't rely on cached allPrompts)
            const userConfig = vscode.workspace.getConfiguration('promptcode');
            const userFolders = userConfig.get<string[]>('promptFolders', []);
            const userPrompts = await loadConfiguredPrompts(this._extensionContext, false, userFolders);
            const userPrompt = userPrompts.find(p => p.name === promptName && !p.filePath?.startsWith('http')); // Ensure it's not a data repo prompt
            
            // Prioritize user prompt if it exists and isn't a data repo URL
            if (userPrompt && userPrompt.filePath && !userPrompt.filePath.startsWith('http')) {
                try {
                    const fileUri = vscode.Uri.file(userPrompt.filePath);
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    await vscode.window.showTextDocument(doc);
                    return;
                } catch (err) { // Handle error opening user file path
                    console.error(`Failed to open user prompt file at path ${userPrompt.filePath}:`, err);
                    vscode.window.showErrorMessage(`Could not open user prompt file: ${userPrompt.name}`);
                    // Don't fall through, as the specific user file couldn't be opened.
                    return; 
                }
            } else if (builtInPrompt && builtInPrompt.filePath) { // Ensure built-in has a filePath
                try {
                    const fileUri = vscode.Uri.parse(builtInPrompt.filePath); // Use parse for potential non-file URIs
                    if (fileUri.scheme === 'file') {
                        // Built-in prompt from the extension bundle
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        await vscode.window.showTextDocument(doc, { preview: false }); // Open non-preview
                        vscode.window.showInformationMessage(
                            `Viewing built-in prompt. To customize, copy it to your workspace's prompt folder.`
                        );
                    } else {
                        // Handle other schemes if necessary, e.g., showing content in a temporary file
                        throw new Error(`Unsupported URI scheme for built-in prompt: ${fileUri.scheme}`);
                    }
                    return;
                } catch (err) {
                    console.error(`Failed to open built-in prompt ${builtInPrompt.name}:`, err);
                     vscode.window.showErrorMessage(`Could not open built-in prompt: ${builtInPrompt.name}`);
                     return;
                }

            } else {
                 // This case is now primarily for when a prompt is looked up by name
                 // and the found filePath is an HTTP URL (which we decided not to open directly above)
                 // or if the prompt simply isn't found after all checks.
                 const foundPrompt = userPrompt || builtInPrompt; // Check if we found *any* prompt with this name
                 if (foundPrompt && foundPrompt.filePath && foundPrompt.filePath.startsWith('http')) {
                     // This message is relevant if lookup-by-name finds an HTTP prompt
                     vscode.window.showInformationMessage(`Cannot open remote prompt "${promptName}" directly by name lookup. Select it with @ in Instructions to embed or click its entry in the prompt list to view its content.`);
                 } else {
                     // Generic not found message
                     vscode.window.showErrorMessage(`Prompt "${promptName}" not found or cannot be opened.`);
                 }
            }
        } catch (error) {
            console.error('Error opening prompt file:', error);
            const errorMessage = error instanceof Error
                ? error.message
                : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to open prompt file: ${errorMessage}`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, prompts: Prompt[]): string {
        // When packaging extensions, resources should be accessed relative to the extension
        // In development they're in src/, in production they're copied to out/
        const getWebviewResource = (fileName: string) => {
            // Try the out/webview folder first (production build)
            const prodPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', fileName);
            const srcPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', fileName);
            
            // Check if the file exists in the production path
            try {
                const fs = require('fs');
                const prodFilePath = prodPath.fsPath;
                if (fs.existsSync(prodFilePath)) {
                    return webview.asWebviewUri(prodPath);
                }
            } catch (err) {
                console.log('Error checking resource path:', err);
            }
            
            // Fall back to source path (development mode)
            return webview.asWebviewUri(srcPath);
        };

        const cssUri = getWebviewResource('styles/index.css');
        const jsUri = getWebviewResource('webview.js');
        const selectFilesTabJsUri = getWebviewResource('selectFilesTab.js');
        const instructionsTabJsUri = getWebviewResource('instructionsTab.js');
        const generatePromptTabJsUri = getWebviewResource('generatePromptTab.js');
        const mergeTabJsUri = getWebviewResource('mergeTab.js');

        // Use local copy of codicons from extension's output directory
        const codiconsUri = getWebviewResource('codicons/codicon.css');

        const promptsJson = JSON.stringify(prompts);

        return /* html */ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>PromptCode</title>
                <link rel="stylesheet" href="${cssUri}">
                <link rel="stylesheet" href="${codiconsUri}">
                <script>
                    // Global error handler
                    window.onerror = function(msg, url, line, col, error) {
                        console.error('Global error:', { msg, url, line, col, error });
                        return false;
                    };
                    
                    // Track script loading
                    window._scriptLoaded = {
                        selectFilesTab: false,
                        instructionsTab: false,
                        webview: false,
                        generatePromptTab: false,
                        mergeTab: false
                    };
                </script>
            </head>
            <body>
                <div class="app-container">
                    <header class="header">
                        <div class="header-title">
                            <h1>PromptCode <span class="company">by <a href="https://cogflows.dev" target="_blank" rel="noopener noreferrer" class="company-link">cogflows</a></span></h1>
                        </div>
                        <p class="subtitle">Generate AI prompts from your codebase with precision</p>
                    </header>

                    <main>
                        <div class="tabs">
                            <div class="tabs-list">
                                <button class="tab-trigger active" data-tab="files">
                                    <span class="codicon codicon-files"></span>
                                    1. Select Files
                                </button>
                                <button class="tab-trigger" data-tab="instructions">
                                    <span class="codicon codicon-note"></span>
                                    2. Add Instructions
                                </button>
                                <button class="tab-trigger" data-tab="prompt">
                                    <span class="codicon codicon-comment-discussion"></span>
                                    3. Generate Prompt
                                </button>
                                <button class="tab-trigger" data-tab="merge">
                                    <span class="codicon codicon-git-pull-request"></span>
                                    4. Apply & Review
                                </button>
                            </div>

                            <!-- Files Tab -->
                            <div class="tab-content active" id="files-tab">
                                ${getSelectFilesTabHtml()}
                            </div>

                            <!-- Instructions Tab -->
                            <div class="tab-content" id="instructions-tab">
                                ${getInstructionsTabHtml()}
                            </div>

                            <!-- Prompt Tab -->
                            <div class="tab-content" id="prompt-tab">
                                ${getPromptTabHtml()}
                            </div>

                            <!-- Merge Tab -->
                            <div class="tab-content" id="merge-tab">
                                ${getMergeTabHtml()}
                            </div>
                        </div>
                    </main>

                    <footer class="footer">
                        <p>
                            PromptCode v${this.packageVersion} •
                            <a href="#" target="_blank" rel="noopener noreferrer">Documentation</a> •
                            <a href="#" target="_blank" rel="noopener noreferrer">Report Issue</a>
                        </p>
                    </footer>
                </div>
                <script>
                    window.samplePrompts = ${promptsJson};
                </script>
                
                <!-- Load selectFilesTab.js first -->
                <script src="${selectFilesTabJsUri}" 
                    onload="window._scriptLoaded.selectFilesTab = true; console.log('selectFilesTab.js loaded')" 
                    onerror="console.error('Failed to load selectFilesTab.js')">
                </script>

                <!-- Load instructionsTab.js next -->
                <script src="${instructionsTabJsUri}"
                    onload="window._scriptLoaded.instructionsTab = true; console.log('instructionsTab.js loaded')"
                    onerror="console.error('Failed to load instructionsTab.js')">
                </script>
                
                <!-- Load generatePromptTab.js -->
                <script src="${generatePromptTabJsUri}"
                    onload="window._scriptLoaded.generatePromptTab = true; console.log('generatePromptTab.js loaded')"
                    onerror="console.error('Failed to load generatePromptTab.js')">
                </script>

                <!-- Load mergeTab.js -->
                <script src="${mergeTabJsUri}"
                    onload="window._scriptLoaded.mergeTab = true; console.log('mergeTab.js loaded')"
                    onerror="console.error('Failed to load mergeTab.js')">
                </script>

                <!-- Then load webview.js which depends on them -->
                <script src="${jsUri}" 
                    onload="window._scriptLoaded.webview = true; console.log('webview.js loaded')" 
                    onerror="console.error('Failed to load webview.js')">
                </script>
                
                <!-- Verify everything loaded -->
                <script>
                    setTimeout(() => {
                        if (!window._scriptLoaded.selectFilesTab) {
                            console.error('selectFilesTab.js failed to load properly');
                        }
                        if (!window._scriptLoaded.instructionsTab) {
                            console.error('instructionsTab.js failed to load properly');
                        }
                        if (!window._scriptLoaded.webview) {
                            console.error('webview.js failed to load properly');
                        }
                        if (typeof window.initSelectFilesTab !== 'function') {
                            console.error('initSelectFilesTab is not available');
                        }
                        if (typeof window.initInstructionsTab !== 'function') {
                            console.error('initInstructionsTab is not available');
                        }
                        if (typeof window.initMergeTab !== 'function') {
                            console.error('initMergeTab is not available');
                        }
                    }, 1000);
                </script>
            </body>
            </html>
        `;
    }

    /**
     * Sends the list of unmatched patterns from the file list processing
     * back to the webview.
     * @param unmatchedPatterns Array of patterns that did not match any files.
     * @param matchedCount The number of files that were successfully matched and selected.
     */
    public sendUnmatchedPatterns(unmatchedPatterns: string[], matchedCount: number): void {
        if (this._panel && this._panel.webview) {
            console.log(`Sending unmatched patterns to webview: ${unmatchedPatterns.length} unmatched, ${matchedCount} matched.`);
            this._panel.webview.postMessage({
                command: 'updateUnmatchedPatterns', // Ensure the webview listens for this command
                unmatchedPatterns: unmatchedPatterns,
                matchedCount: matchedCount
            });
        } else {
            console.warn('Webview panel not available to send unmatched patterns.');
        }
    }
}