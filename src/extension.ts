/* PromptCode - Copyright (C) 2025. All Rights Reserved. */

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { FileExplorerProvider, checkedItems, FileItem } from './fileExplorer';
import { generatePrompt as generatePromptFromGenerator, copyToClipboard } from './promptGenerator';
import { PromptCodeWebViewProvider } from './webviewProvider';
import { countTokensInFile, countTokensWithCache, clearTokenCache, initializeTokenCounter } from './tokenCounter';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import * as path from 'path';
import * as fs from 'fs';
import { IgnoreHelper } from './ignoreHelper';
import * as os from 'os';
import { DEFAULT_IGNORE_PATTERNS } from './constants';
import { TelemetryService } from './telemetry';
import { FileListProcessor } from './fileListProcessor';

let lastGeneratedPrompt: string | null = null; // Variable to store the last generated prompt

// Export a getter for the last generated prompt
export function getLastGeneratedPrompt(): string | null {
	return lastGeneratedPrompt;
}

let lastGeneratedTokenCount: number | null = null;
let webviewProvider: PromptCodeWebViewProvider | null = null;
let lastSaveUri: vscode.Uri | undefined = undefined; // Store the last used save URI

// Define or import the SelectedFile type (adjust properties if needed)
type SelectedFile = {
	path: string; // relative path
	absolutePath: string;
	tokenCount: number;
	workspaceFolderRootPath: string;
	workspaceFolderName: string;
};

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Activating PromptCode extension');

	// Initialize telemetry service
	const telemetryService = TelemetryService.getInstance(context);
	telemetryService.sendTelemetryEvent('extension_activated');

	// Log telemetry status during activation to aid debugging
	telemetryService.logTelemetryStatus();

	// Initialize token counter with global storage path
	if (context.globalStorageUri) {
		initializeTokenCounter(context.globalStorageUri.fsPath);
	} else {
		// Fallback to extension path if globalStorageUri is not available
		const storagePath = path.join(context.extensionPath, '.cache');
		initializeTokenCounter(storagePath);
		console.log(`Using fallback storage path: ${storagePath}`);
	}

	// Initialize output channel
	const outputChannel = vscode.window.createOutputChannel('PromptCode');
	outputChannel.show(true);

	// Get the workspace folder
	const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
		? vscode.workspace.workspaceFolders[0].uri.fsPath
		: undefined;

	// Create the file explorer provider
	const fileExplorerProvider = new FileExplorerProvider();
	// const ignoreHelper = new IgnoreHelper(); // ignoreHelper is now internal to fileExplorerProvider

	// Register the tree data provider
	const treeView = vscode.window.createTreeView('promptcodeExplorer', {
		treeDataProvider: fileExplorerProvider,
		showCollapseAll: true,
		canSelectMany: false, // Keep false for checkbox behavior
		manageCheckboxStateManually: true
	} as vscode.TreeViewOptions<FileItem>);


	// Set the tree view instance in the provider
	fileExplorerProvider.setTreeView(treeView);

	// Handle checkbox toggling
	treeView.onDidChangeCheckboxState(event => {
		event.items.forEach(([item, state]) => {
			if (item instanceof FileItem) {
				fileExplorerProvider.handleCheckboxToggle(item, state);
			}
		});
	});

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('promptcode.respectGitignore')) {
				// Refresh the ignore helper when the respectGitignore setting changes
				fileExplorerProvider.refreshIgnoreHelper();
			}
		})
	);

	// Create the PromptCode webview provider
	const promptCodeProvider = new PromptCodeWebViewProvider(context.extensionUri, context);

	// Show WebView when tree view becomes visible, hide it when not visible
	treeView.onDidChangeVisibility(e => {
		if (e.visible) {
			promptCodeProvider.showWebView();
			// Request selected files update when view becomes visible
			setTimeout(() => {
				vscode.commands.executeCommand('promptcode.getSelectedFiles');
			}, 100);
		} else {
			// Just hide the webview instead of closing it
			// No action needed - VS Code handles hiding automatically
		}
	});

	// Register a command to show the PromptCode webview
	const showPromptCodeViewCommand = vscode.commands.registerCommand('promptcode.showPromptCodeView', () => {
		promptCodeProvider.showWebView();
	});

	// Register the command to filter files based on search term
	const filterFilesCommand = vscode.commands.registerCommand('promptcode.filterFiles', async (searchTerm: string) => {
		await fileExplorerProvider.setSearchTerm(searchTerm);
	});

	// Register the command to show when the view container is activated
	context.subscriptions.push(showPromptCodeViewCommand);

	// If tree view is already visible on activation, show the webview
	if (treeView.visible) {
		promptCodeProvider.showWebView();
	}

	// Register select all command
	const selectAllCommand = vscode.commands.registerCommand('promptcode.selectAll', () => {
		fileExplorerProvider.selectAll();
		TelemetryService.getInstance().sendTelemetryEvent('select_all_files');
	});

	// Register deselect all command
	const deselectAllCommand = vscode.commands.registerCommand('promptcode.deselectAll', () => {
		fileExplorerProvider.deselectAll();
		TelemetryService.getInstance().sendTelemetryEvent('deselect_all_files');
	});

	// Register expand all command
	const expandAllCommand = vscode.commands.registerCommand('promptcode.expandAll', () => {
		console.log('expandAll command triggered in extension.ts');
		fileExplorerProvider.expandAll().then(() => {
			console.log('expandAll completed');
		}).catch(err => {
			console.error('Error in expandAll:', err);
			vscode.window.showErrorMessage(`Failed to expand all: ${err.message}`);
		});
	});

	// Register collapse all command
	const collapseAllCommand = vscode.commands.registerCommand('promptcode.collapseAll', () => {
		console.log('collapseAll command triggered in extension.ts');
		fileExplorerProvider.collapseAll().then(() => {
			console.log('collapseAll completed');
		}).catch(err => {
			console.error('Error in collapseAll:', err);
			vscode.window.showErrorMessage(`Failed to collapse all: ${err.message}`);
		});
	});

	// Register show file selector command
	const showFileSelectorCommand = vscode.commands.registerCommand('promptcode.showFileSelector', () => {
		// Focus the tree view
		vscode.commands.executeCommand('promptcodeExplorer.focus');
	});

	// Register generate prompt command
	const generatePromptCommand = vscode.commands.registerCommand('promptcode.generatePrompt', async () => {
		// Generate the prompt text
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Generating Prompt',
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0 });

			try {
				const startTime = Date.now();
				const selectedFiles = await getSelectedFilesWithContent(); // Uses updated logic
				const instructions = context.workspaceState.get('promptcode.instructions', '');
				// Get includeOptions from workspace state - throw if not found
				const savedOptions = context.workspaceState.get('promptcode.includeOptions');

				// Validate includeOptions
				if (!isValidIncludeOptions(savedOptions)) {
					throw new Error('Invalid includeOptions found. Please visit the Generate Prompt tab first to set your preferences.');
				}

				const promptText = await generatePromptFromGenerator(selectedFiles, instructions, savedOptions);
				const executionTime = Date.now() - startTime;

				// Create a new document to show the prompt
				const document = await vscode.workspace.openTextDocument({
					content: promptText,
					language: 'markdown'
				});

				// Show the document
				await vscode.window.showTextDocument(document);

				// Show success message with copy option
				const copyAction = 'Copy to Clipboard';
				vscode.window.showInformationMessage(
					'Prompt generated successfully!',
					copyAction
				).then(selection => {
					if (selection === copyAction) {
						copyToClipboard(promptText).then(() => {
							vscode.window.showInformationMessage('Prompt copied to clipboard');
						});
					}
				});

				// Send telemetry
				TelemetryService.getInstance().sendTelemetryEvent('prompt_generated', {
					includeFiles: String(savedOptions.files),
					includeInstructions: String(savedOptions.instructions)
				}, {
					fileCount: selectedFiles.length,
					tokenCount: countTokens(promptText),
					executionTimeMs: executionTime
				});

				progress.report({ increment: 100 });
			} catch (error) {
				// Send error telemetry
				TelemetryService.getInstance().sendTelemetryException(error instanceof Error ? error : new Error(String(error)));
				vscode.window.showErrorMessage(`Error generating prompt: ${(error as Error).message || String(error)}`);
			}

			return Promise.resolve();
		});
	});

	// Register generate prompt preview command
	const generatePromptPreviewCommand = vscode.commands.registerCommand('promptcode.generatePromptPreview', async (params) => {
		try {
			const selectedFiles = await getSelectedFilesWithContent();
			const instructions = context.workspaceState.get('promptcode.instructions', '');

			// Require includeOptions from tab3 to be present - no fallbacks
			if (!params?.includeOptions) {
				throw new Error('Missing includeOptions from Generate Prompt tab');
			}
			const includeOptions = params.includeOptions;

			// Store the last used includeOptions in workspace state to use across all commands
			context.workspaceState.update('promptcode.includeOptions', includeOptions);

			// Generate preview with options
			const promptText = await generatePromptFromGenerator(selectedFiles, instructions, includeOptions);

			// Cache the generated prompt
			lastGeneratedPrompt = promptText;

			// Send preview back to webview
			if (promptCodeProvider._panel) {
				promptCodeProvider._panel.webview.postMessage({
					command: 'promptPreviewGenerated',
					preview: promptText,
					tokenCount: countTokens(promptText),
					action: params?.action || 'none'
				});
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Error generating prompt preview: ${(error as Error).message || String(error)}`);
		}
	});

	// Register copy to clipboard command
	const copyToClipboardCommand = vscode.commands.registerCommand('promptcode.copyToClipboard', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const document = editor.document;
			const text = document.getText();
			await copyToClipboard(text);
			vscode.window.showInformationMessage('Content copied to clipboard');
			TelemetryService.getInstance().sendTelemetryEvent('copy_to_clipboard');
		} else {
			vscode.window.showWarningMessage('No active text editor to copy from');
		}
	});

	// Register copy prompt to clipboard command
	const copyPromptDirectlyCommand = vscode.commands.registerCommand('promptcode.copyPromptDirectly', async () => {
		// Generate the prompt text and copy to clipboard
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Generating and Copying Prompt',
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0 });

			try {
				const startTime = Date.now();
				const selectedFiles = await getSelectedFilesWithContent();
				const instructions = context.workspaceState.get('promptcode.instructions', '');
				// Get includeOptions from workspace state - throw if not found
				const savedOptions = context.workspaceState.get('promptcode.includeOptions');

				// Validate includeOptions
				if (!isValidIncludeOptions(savedOptions)) {
					throw new Error('Invalid includeOptions found. Please visit the Generate Prompt tab first to set your preferences.');
				}

				const promptText = await generatePromptFromGenerator(selectedFiles, instructions, savedOptions);
				const executionTime = Date.now() - startTime;

				// Copy to clipboard directly
				await copyToClipboard(promptText);

				// Show success message
				vscode.window.showInformationMessage('Prompt copied to clipboard successfully!');

				// Send telemetry
				TelemetryService.getInstance().sendTelemetryEvent('prompt_copied', {
					includeFiles: String(savedOptions.files),
					includeInstructions: String(savedOptions.instructions)
				}, {
					fileCount: selectedFiles.length,
					tokenCount: countTokens(promptText),
					executionTimeMs: executionTime
				});

				progress.report({ increment: 100 });
			} catch (error) {
				// Send error telemetry
				TelemetryService.getInstance().sendTelemetryException(error instanceof Error ? error : new Error(String(error)));
				vscode.window.showErrorMessage(`Error generating prompt: ${(error as Error).message || String(error)}`);
			}

			return Promise.resolve();
		});
	});

	// Register apply merge command
	const applyMergeCommand = vscode.commands.registerCommand('promptcode.applyMerge', async (content) => {
		outputChannel.appendLine('Apply & Review requested for model output');
		// The parsing and display is handled in the webview
	});

	// Register replace code command
	const replaceCodeCommand = vscode.commands.registerCommand('promptcode.replaceCode', async (message) => {
		try {
			const { filePath, fileOperation, fileCode, workspaceName, workspaceRoot } = message;

			// Find the workspace folder for this file
			let targetWorkspaceFolder: vscode.WorkspaceFolder | undefined;

			if (workspaceName && workspaceRoot) {
				// Try to find the workspace folder by name and root path
				targetWorkspaceFolder = vscode.workspace.workspaceFolders?.find(folder =>
					folder.name === workspaceName && folder.uri.fsPath === workspaceRoot
				);
			}

			if (!targetWorkspaceFolder && filePath) {
                // Fallback: Find workspace folder containing the file path if provided
                // Ensure filePath is treated as relative to some workspace root if workspaceRoot is provided
                const potentialUri = vscode.Uri.file(path.join(workspaceRoot || '', filePath));
                targetWorkspaceFolder = vscode.workspace.getWorkspaceFolder(potentialUri);
            }

            // If still no workspace folder, try finding based on just workspaceRoot if available
            if (!targetWorkspaceFolder && workspaceRoot) {
                targetWorkspaceFolder = vscode.workspace.workspaceFolders?.find(folder => folder.uri.fsPath === workspaceRoot);
            }


			if (!targetWorkspaceFolder) {
				throw new Error(`Could not find workspace folder for file: ${filePath || 'unknown file'}`);
			}

			// Construct the full file path using the determined workspace folder
			const fullPath = path.join(targetWorkspaceFolder.uri.fsPath, filePath);

			// Handle different file operations
			switch (fileOperation.toUpperCase()) {
				case 'CREATE':
					// Create the directory if it doesn't exist
					await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
					// Create the file with the new content
					await fs.promises.writeFile(fullPath, fileCode);
					break;

				case 'UPDATE':
					// Update the file with the new content
					await fs.promises.writeFile(fullPath, fileCode);
					break;

				case 'DELETE':
					// Delete the file
					await fs.promises.unlink(fullPath);
					break;

				default:
					throw new Error(`Unsupported file operation: ${fileOperation}`);
			}

			// Notify the webview that the code was replaced successfully
			if (promptCodeProvider._panel) {
				// Use workspace name and file path for display
				const displayPath = workspaceName ? `${workspaceName}: ${filePath}` : filePath;

				console.log('Sending codeReplaced message:', {
					command: 'codeReplaced',
					filePath,
					displayPath,
					fileOperation,
					success: true
				});

				promptCodeProvider._panel.webview.postMessage({
					command: 'codeReplaced',
					filePath,
					displayPath,
					fileOperation,
					success: true
				});

				// Show a user-friendly message
				const operationMsg = fileOperation.toUpperCase() === 'CREATE' ? 'created' :
					fileOperation.toUpperCase() === 'DELETE' ? 'deleted' : 'updated';
				vscode.window.showInformationMessage(`Successfully ${operationMsg} ${displayPath}`);
			}
		} catch (error) {
			const errorMessage = `Failed to apply code changes: ${error instanceof Error ? error.message : String(error)}`;
			outputChannel.appendLine(errorMessage);
			vscode.window.showErrorMessage(errorMessage);

			// Notify the webview that the operation failed
			if (promptCodeProvider._panel) {
				console.log('Sending codeReplaced error message:', {
					command: 'codeReplaced',
					filePath: message.filePath,
					displayPath: message.filePath, // Fallback display path
					fileOperation: message.fileOperation,
					success: false
				});

				promptCodeProvider._panel.webview.postMessage({
					command: 'codeReplaced',
					filePath: message.filePath,
					displayPath: message.filePath, // Fallback display path
					fileOperation: message.fileOperation,
					success: false
				});
			}
		}
	});


	// Register save ignore config command (now only saves the respectGitignore setting)
	const saveIgnoreConfigCommand = vscode.commands.registerCommand('promptcode.saveIgnoreConfig', async (ignorePatterns: string | undefined, respectGitignore: boolean) => {
		console.log('Saving ignore configuration', { respectGitignore }); // Removed ignorePatterns logging

		// Save the respectGitignore setting
		const configTarget = vscode.workspace.workspaceFolders
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;

		const config = vscode.workspace.getConfiguration('promptcode');
		const oldValue = config.get('respectGitignore');
		console.log('Current respectGitignore setting:', oldValue);

		await config.update('respectGitignore', respectGitignore, configTarget);
		console.log('Updated respectGitignore setting to:', respectGitignore);

		// Immediately read back the value to confirm it was saved
		const newValue = vscode.workspace.getConfiguration('promptcode').get('respectGitignore');
		console.log('Read back respectGitignore value:', newValue);

        // Refresh the ignore helper in the FileExplorerProvider
        fileExplorerProvider.refreshIgnoreHelper();


		// Send an update back to the webview to ensure it's in sync
        // Let the loadIgnoreConfig command handle sending the update
		// No, let's send it back immediately to confirm the save
		if (promptCodeProvider._panel) {
            // We still need to load the current patterns to send back
            const currentIgnorePatterns = await loadIgnorePatterns();
			promptCodeProvider._panel.webview.postMessage({
				command: 'updateIgnoreConfig',
				respectGitignore: newValue,
				ignorePatterns: currentIgnorePatterns // Send back the patterns currently in use
			});
		}
	});

	// Register save prompts config command
	const savePromptsConfigCommand = vscode.commands.registerCommand('promptcode.savePromptsConfig', async (promptFolders: string, includeBuiltInTemplates: boolean) => {
		console.log('Saving prompts configuration', { includeBuiltInTemplates });

		// Save the includeBuiltInTemplates setting
		const configTarget = vscode.workspace.workspaceFolders
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;

		const config = vscode.workspace.getConfiguration('promptcode');
		await config.update('includeBuiltInTemplates', includeBuiltInTemplates, configTarget);

		// Save the promptFolders
		await config.update('promptFolders', promptFolders.split('\n').map(folder => folder.trim()).filter(folder => folder), configTarget);

		// Show success message
		vscode.window.showInformationMessage('Successfully saved prompts configuration');
	});

	// --- ADDED HELPER ---
    async function loadIgnorePatterns(): Promise<string> {
        // Try to load .promptcode_ignore if it exists
		let ignorePatterns = '';
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			const workspaceRoot = workspaceFolders[0].uri.fsPath;
			const ignoreFilePath = path.join(workspaceRoot, '.promptcode_ignore');

			try {
				if (fs.existsSync(ignoreFilePath)) {
					ignorePatterns = await fs.promises.readFile(ignoreFilePath, 'utf8');
					console.log(`Loaded .promptcode_ignore file from ${ignoreFilePath}`);
				} else {
					// Provide default ignore patterns if file doesn't exist
					ignorePatterns = DEFAULT_IGNORE_PATTERNS;
                     console.log(`No .promptcode_ignore found, using defaults.`);
				}
			} catch (err) {
				console.error('Error loading ignore patterns:', err);
                 ignorePatterns = DEFAULT_IGNORE_PATTERNS; // Use defaults on error
			}
		} else {
            ignorePatterns = DEFAULT_IGNORE_PATTERNS; // Use defaults if no workspace
        }
        return ignorePatterns;
    }
    // --- END ADDED HELPER ---

	// Load ignore configuration
	const loadIgnoreConfigCommand = vscode.commands.registerCommand('promptcode.loadIgnoreConfig', async () => {
		console.log('Loading ignore configuration');

		// Load respectGitignore from settings
		const config = vscode.workspace.getConfiguration('promptcode');
		const respectGitignore = config.get('respectGitignore', true);
		console.log('Loaded respectGitignore setting:', respectGitignore);

        // Load ignore patterns
        const ignorePatterns = await loadIgnorePatterns();

		// Send back to webview
		if (promptCodeProvider._panel) {
			promptCodeProvider._panel.webview.postMessage({
				command: 'updateIgnoreConfig',
				respectGitignore,
				ignorePatterns
			});
		}
	});


	// Load prompts configuration
	const loadPromptsConfigCommand = vscode.commands.registerCommand('promptcode.loadPromptsConfig', async () => {
		console.log('Loading prompts configuration');

		// Load settings from configuration
		const config = vscode.workspace.getConfiguration('promptcode');
		const includeBuiltInTemplates = config.get('includeBuiltInTemplates', true);
		const promptFoldersArray = config.get('promptFolders', [
			'.promptcode/prompts',
			'.cursor/rules',
			'.github/copilot-instructions.md',
			'.zed/',
			'.windsurfrules',
			'.clinerules',
			'.ai-rules/',
			'ai-docs/'
		]);

		// Convert array to string with newlines
		const promptFolders = promptFoldersArray.join('\n');

		// Send back to webview
		if (promptCodeProvider._panel) {
			promptCodeProvider._panel.webview.postMessage({
				command: 'loadPromptsConfig',
				includeBuiltInTemplates,
				promptFolders
			});
		}
	});

	// Register get selected files command
	const getSelectedFilesCommand = vscode.commands.registerCommand('promptcode.getSelectedFiles', async () => {
		// Exit early if no panel exists to receive the updates
		if (!promptCodeProvider._panel) {
			console.log('No webview panel available to send selected files to');
			return;
		}

		// Ensure empty state is handled properly when no workspace is open
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			console.log('No workspace folders open, sending empty selection state');
			if (promptCodeProvider._panel) {
                promptCodeProvider._panel.webview.postMessage({
                    command: 'updateSelectedFiles',
                    selectedFiles: [],
                    totalTokens: 0
                });
            }
			return;
		}

		try {
			console.log('Getting selected files to update webview');
            const currentIgnoreHelper = fileExplorerProvider.getIgnoreHelper(); // Get current helper

			// Get all checked items
			const selectedFilePaths = Array.from(checkedItems.entries())
				.filter(([_, isChecked]) => isChecked)
				.map(([filePath, _]) => filePath)
				// Filter to only include files (not directories)
				.filter(filePath => {
					try {
						// Double check existence and type
                        if (!fs.existsSync(filePath)) return false;
						return fs.statSync(filePath).isFile();
					} catch (error) {
						console.log(`Error checking file ${filePath}:`, error);
						return false;
					}
				})
				// Add filter to exclude files that should be ignored based on current ignore rules
				.filter(filePath => {
					// If ignoreHelper doesn't exist yet, include all files
					if (!currentIgnoreHelper) {
						return true;
					}
					// Check if the file should be ignored
					const shouldBeIgnored = currentIgnoreHelper.shouldIgnore(filePath);
					if (shouldBeIgnored) {
						console.log(`Filtering out now-ignored file from selected files: ${filePath}`);
						// Also update the selection state since we're filtering it out
						// No, don't modify checkedItems here, let the source trigger handle it
                        // checkedItems.set(filePath, false);
					}
					return !shouldBeIgnored;
				});

			console.log(`Found ${selectedFilePaths.length} selected files to show in webview`);

			// Get file contents and token counts
			const selectedFilesPromises = selectedFilePaths.map(async (absolutePath): Promise<SelectedFile> => { // Ensure the map returns a Promise<SelectedFile>
				// Find which workspace folder this file belongs to
				let workspaceFolderName: string | undefined = undefined;
				let workspaceFolderRootPath: string | undefined = undefined;
				let relativePath = absolutePath; // Default to absolute if not in workspace

				const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absolutePath));
				if (folder) {
					workspaceFolderName = folder.name;
					workspaceFolderRootPath = folder.uri.fsPath;
					relativePath = path.relative(workspaceFolderRootPath, absolutePath);
				}

				// If still undefined, try to find the *closest* workspace folder if multiple exist
				if (!workspaceFolderRootPath && vscode.workspace.workspaceFolders) {
					let bestMatch: vscode.WorkspaceFolder | undefined;
					let maxOverlap = -1;

					vscode.workspace.workspaceFolders.forEach(wsFolder => {
						if (absolutePath.startsWith(wsFolder.uri.fsPath)) {
							const overlap = wsFolder.uri.fsPath.length;
							if (overlap > maxOverlap) {
								maxOverlap = overlap;
								bestMatch = wsFolder;
							}
						}
					});

					if (bestMatch) {
						workspaceFolderName = bestMatch.name;
						workspaceFolderRootPath = bestMatch.uri.fsPath;
						relativePath = path.relative(workspaceFolderRootPath, absolutePath);
					}
				}

				const tokenCount = await countTokensWithCache(absolutePath);

				// Return an object matching the SelectedFile type
				return {
					path: relativePath,
					absolutePath,
					tokenCount,
					workspaceFolderName: workspaceFolderName || 'Unknown Workspace', // Provide default string
					workspaceFolderRootPath: workspaceFolderRootPath || '', // Provide default string
				};
			});

			const selectedFiles = await Promise.all(selectedFilesPromises);

			// Calculate total tokens
			const totalTokens = selectedFiles.reduce((sum, file) => sum + file.tokenCount, 0);

			// Send the selected files with token counts back to the webview
			if (promptCodeProvider._panel) {
				promptCodeProvider._panel.webview.postMessage({
					command: 'updateSelectedFiles',
					selectedFiles: selectedFiles,
					totalTokens: totalTokens
				});
			}
		} catch (error) {
			console.error('Error getting selected files:', error);
		}
	});


	// Register deselect file command
	const deselectFileCommand = vscode.commands.registerCommand('promptcode.deselectFile', async (relativeFilePath: string, workspaceFolderRootPath?: string) => {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return;
		}

		try {
			let absoluteFilePath: string | undefined;

			if (workspaceFolderRootPath && fs.existsSync(workspaceFolderRootPath)) {
				// If workspace folder root path is provided and exists, use it
				absoluteFilePath = path.join(workspaceFolderRootPath, relativeFilePath);
			} else {
				// Try each workspace folder until we find one that works
				let fileFound = false;
                const uriToFind = vscode.Uri.file(relativeFilePath); // Assume relative path might be unique enough

				for (const folder of vscode.workspace.workspaceFolders) {
					const testPath = path.join(folder.uri.fsPath, relativeFilePath);
					try {
                        // Check if file actually exists at this constructed path
						await fs.promises.access(testPath, fs.constants.F_OK);
						absoluteFilePath = testPath;
						fileFound = true;
						break;
					} catch {
						// File doesn't exist in this workspace folder, try next one
						continue;
					}
				}

				if (!fileFound) {
                    // Last resort: maybe the provided path was already absolute?
                    if(path.isAbsolute(relativeFilePath) && fs.existsSync(relativeFilePath)) {
                        absoluteFilePath = relativeFilePath;
                        console.log(`Using provided path as absolute: ${absoluteFilePath}`);
                    } else {
                       console.log(`File not found in any workspace folder, cannot deselect: ${relativeFilePath}`);
                       return; // Could not resolve the path
                    }
				}
			}

			// Uncheck the file in the checkedItems map
			if (absoluteFilePath && checkedItems.has(absoluteFilePath)) {
				checkedItems.set(absoluteFilePath, false);

				// Update parent directories' checkbox states
				await fileExplorerProvider.updateParentStates(absoluteFilePath);

				// Refresh the tree view
				fileExplorerProvider.refresh();

				// Update the selected files list in the webview
				vscode.commands.executeCommand('promptcode.getSelectedFiles');
			} else {
				console.log(`File not in checked items or path unresolved: ${absoluteFilePath || relativeFilePath}`);
			}
		} catch (error) {
			console.error(`Error deselecting file: ${relativeFilePath}`, error);
		}
	});


	// Register remove directory command
	const removeDirectoryCommand = vscode.commands.registerCommand('promptcode.removeDirectory', async (dirPath: string, workspaceFolderName?: string) => {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return;
		}

		try {
			console.log(`Removing files from directory: ${dirPath} in workspace folder: ${workspaceFolderName || 'all'}`);

			// Find matching workspace folder root path if workspace folder name is provided
			let targetWorkspaceFolderRootPath: string | undefined;
			if (workspaceFolderName) {
				const workspaceFolder = vscode.workspace.workspaceFolders.find(folder => folder.name === workspaceFolderName);
				if (workspaceFolder) {
					targetWorkspaceFolderRootPath = workspaceFolder.uri.fsPath;
				} else {
                    console.warn(`Workspace folder named "${workspaceFolderName}" not found.`);
                    // Optionally proceed without workspace filter, or return early
                    // Let's proceed but log a warning
                }
			}

			// Get all checked items
			const checkedFilePaths = Array.from(checkedItems.entries())
				.filter(([_, isChecked]) => isChecked)
				.map(([filePath, _]) => filePath);

			// Function to check if a file is in the specified directory relative to its workspace
			const isFileInDirectory = (absoluteFilePath: string, targetRelativeDirPath: string, targetWorkspaceRoot?: string): boolean => {
                 const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absoluteFilePath));
                 if (!workspaceFolder) return false; // Not in any workspace

                 // If a specific target workspace is defined, only consider files from that workspace
                 if (targetWorkspaceRoot && workspaceFolder.uri.fsPath !== targetWorkspaceRoot) {
                     return false;
                 }

                 const fileRelativePath = path.relative(workspaceFolder.uri.fsPath, absoluteFilePath);
                 const fileDirPath = path.dirname(fileRelativePath);

                 // Handle root directory case '.'
                 if (targetRelativeDirPath === '.') {
                     // File is in root if its directory path is '.'
                     return fileDirPath === '.';
                 }

                 // Check if the file's directory path starts with the target directory path
                 // Normalize paths to use forward slashes for comparison
                 const normalizedFileDirPath = fileDirPath.replace(/\\/g, '/');
                 const normalizedTargetDirPath = targetRelativeDirPath.replace(/\\/g, '/');

                 return normalizedFileDirPath === normalizedTargetDirPath || normalizedFileDirPath.startsWith(normalizedTargetDirPath + '/');
			};

			// Find all checked files in the specified directory
			let filesToDeselect = checkedFilePaths.filter(filePath =>
				isFileInDirectory(filePath, dirPath, targetWorkspaceFolderRootPath)
			);

			console.log(`Found ${filesToDeselect.length} files to deselect in directory: ${dirPath}`);

			// Deselect each file
            let parentsToUpdate = new Set<string>();
			for (const filePath of filesToDeselect) {
				checkedItems.set(filePath, false);
                parentsToUpdate.add(path.dirname(filePath));
			}

             // Update parent states efficiently
            for(const parentPath of parentsToUpdate) {
               await fileExplorerProvider.updateParentStates(path.join(parentPath, 'dummyfile')); // Pass a dummy path inside the parent
            }


			// Refresh the tree view
			fileExplorerProvider.refresh();

			// Update the selected files list in the webview
			vscode.commands.executeCommand('promptcode.getSelectedFiles');
		} catch (error) {
			console.error(`Error removing directory: ${dirPath}`, error);
		}
	});


	// Register copy file path command
	const copyFilePathCommand = vscode.commands.registerCommand('promptcode.copyFilePath', (fileItem: FileItem | string) => {
		const fullPath = typeof fileItem === 'string' ? fileItem : fileItem?.fullPath;
		if (fullPath) {
			vscode.env.clipboard.writeText(fullPath);
			const type = typeof fileItem !== 'string' && fileItem.isDirectory ? 'folder' : 'file';
			vscode.window.showInformationMessage(`Copied ${type} absolute path to clipboard: ${fullPath}`);
		}
	});


	// Register copy relative file path command
	const copyRelativeFilePathCommand = vscode.commands.registerCommand('promptcode.copyRelativeFilePath', (fileItem: FileItem | string) => {
		const fullPath = typeof fileItem === 'string' ? fileItem : fileItem?.fullPath;
		if (fullPath) {
             const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fullPath));
             if(workspaceFolder) {
                const relativePath = path.relative(workspaceFolder.uri.fsPath, fullPath);
                vscode.env.clipboard.writeText(relativePath);
                const type = typeof fileItem !== 'string' && fileItem.isDirectory ? 'folder' : 'file';
                vscode.window.showInformationMessage(`Copied ${type} relative path to clipboard: ${relativePath}`);
            } else {
                 vscode.window.showWarningMessage(`Could not determine relative path for: ${fullPath}`);
            }
		}
	});


	// Register clear token cache command
	const clearTokenCacheCommand = vscode.commands.registerCommand('promptcode.clearTokenCache', () => {
		clearTokenCache();
		fileExplorerProvider.refresh();
		vscode.window.showInformationMessage('Token cache cleared successfully');
	});

	// Register complete file explorer refresh command
	const refreshFileExplorerCommand = vscode.commands.registerCommand('promptcode.refreshFileExplorer', async () => {
		console.log('Performing file explorer refresh');
		await fileExplorerProvider.refreshIgnoreHelper();
		fileExplorerProvider.refresh();
		vscode.commands.executeCommand('promptcode.getSelectedFiles');
		vscode.window.showInformationMessage('File explorer refreshed successfully');
	});

	// Register open file in editor command
	const openFileInEditorCommand = vscode.commands.registerCommand('promptcode.openFileInEditor', (fileItemOrPath: FileItem | string, workspaceFolderRootPath?: string) => {
		try {
			let fileUri: vscode.Uri | undefined;

			if (typeof fileItemOrPath === 'string') {
				// If a string path is provided (from WebView or List Import)
				const filePath = fileItemOrPath;

				// Check if it's an absolute path
				if (path.isAbsolute(filePath)) {
					fileUri = vscode.Uri.file(filePath);
				} else {
					// It's a relative path, check if workspaceFolderRootPath is provided and valid
					if (workspaceFolderRootPath && fs.existsSync(workspaceFolderRootPath)) {
						fileUri = vscode.Uri.file(path.join(workspaceFolderRootPath, filePath));
					} else {
						// Try to find the file in one of the workspace folders
						let found = false;

						for (const folder of vscode.workspace.workspaceFolders || []) {
							const fullPath = path.join(folder.uri.fsPath, filePath);
							if (fs.existsSync(fullPath)) {
								fileUri = vscode.Uri.file(fullPath);
								found = true;
								break;
							}
						}

						if (!found) {
							throw new Error(`Could not find file ${filePath} in any workspace folder`);
						}
					}
				}
			} else {
				// If a FileItem is provided (from TreeView)
                // Ensure it's not a directory before trying to open
                if (fileItemOrPath.isDirectory) {
                    console.log(`Cannot open directory in editor: ${fileItemOrPath.fullPath}`);
                    return; // Do nothing for directories
                }
				fileUri = vscode.Uri.file(fileItemOrPath.fullPath);
			}

			// Open the document
			if (fileUri) {
				vscode.window.showTextDocument(fileUri, { preview: false }) // Open non-preview
					.then(
						editor => console.log(`Successfully opened ${fileUri.fsPath}`),
						error => {
							console.error(`Failed to open document: ${error}`);
							vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
						}
					);
			} else {
				throw new Error('Failed to resolve file URI');
			}
		} catch (error) {
			console.error('Error opening file in editor:', error);
			vscode.window.showErrorMessage(`Error opening file: ${error instanceof Error ? error.message : String(error)}`);
		}
	});


	// Register show new content command
	const showNewContentCommand = vscode.commands.registerCommand('promptcode.showNewContent', async (message) => {
		// ... (implementation remains the same) ...
	});

	// Register show diff command
	const showDiffCommand = vscode.commands.registerCommand('promptcode.showDiff', async (message) => {
		// ... (implementation remains the same) ...
	});

	// Register debug refresh selected files command
	const debugRefreshSelectedFilesCommand = vscode.commands.registerCommand('promptcode.debugRefreshSelectedFiles', () => {
		getSelectedFilesWithContent().then(files => {
			console.log('Currently selected files:', files.map(file => file.path));
		});
	});

    // --- ADDED ---
    // Register command to load and process file list
    const loadAndProcessFileListCommand = vscode.commands.registerCommand('promptcode.loadAndProcessFileList', async () => {
        try {
            const fileUris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFolders: false,
                title: 'Select File List',
                // Optionally filter for specific file types like .txt, .list, etc.
                // filters: {
                //     'Text Files': ['txt', 'list']
                // }
            });

            if (fileUris && fileUris.length > 0) {
                // Get current selection
                const currentSelection = new Set<string>();
                for (const [path, isChecked] of checkedItems.entries()) {
                    if (isChecked) {
                        currentSelection.add(path);
                    }
                }
                const initialSelectedCount = currentSelection.size;

                const fileUri = fileUris[0];
                const fileContent = await fs.promises.readFile(fileUri.fsPath, 'utf8');

                const currentWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!currentWorkspaceRoot) {
                    throw new Error('No active workspace folder found.');
                }

                const currentIgnoreHelper = fileExplorerProvider.getIgnoreHelper();
                if (!currentIgnoreHelper) {
                    // Don't throw, allow proceeding without ignore filtering if helper isn't ready
                    console.warn('Ignore helper not initialized during list processing.');
                    // throw new Error('Ignore helper not initialized.');
                }

                const processor = new FileListProcessor(currentWorkspaceRoot, currentIgnoreHelper);
                const { matchedFiles, unmatchedPatterns } = await processor.processList(fileContent);

                // Combine current selection with newly matched files
                const combinedSelection = new Set<string>([...currentSelection, ...matchedFiles]);

                // Update the file explorer's checked items using the combined set
                await fileExplorerProvider.setCheckedItems(combinedSelection);

                // Get the final count AFTER setCheckedItems has run
                const finalSelectedCount = Array.from(checkedItems.values()).filter(Boolean).length;
                const addedCount = finalSelectedCount - initialSelectedCount;

                // Send unmatched patterns back to the webview regardless
                if (promptCodeProvider._panel) {
                    // Send the count of *actually* newly matched/added files
                    promptCodeProvider.sendUnmatchedPatterns(unmatchedPatterns, Math.max(0, addedCount)); 
                }

                // Notify user based on the outcome
                let notificationMessage = '';
                if (addedCount > 0) {
                    notificationMessage = `Processed file list: Added ${addedCount} file(s). Total selected: ${finalSelectedCount}. ${unmatchedPatterns.length} pattern(s) didn't match.`;
                } else if (matchedFiles.size > 0 && addedCount <= 0) {
                    notificationMessage = `Processed file list: Selection updated. Total selected: ${finalSelectedCount}. ${unmatchedPatterns.length} pattern(s) didn't match.`;
                } else {
                    notificationMessage = `Processed file list: No new matching files found. Total selected: ${finalSelectedCount}. ${unmatchedPatterns.length} pattern(s) didn't match.`;
                }
                vscode.window.showInformationMessage(notificationMessage);

                // Send combined telemetry
                telemetryService.sendTelemetryEvent('list_processed_combined',
                    { source: 'file' }, // Properties
                    { // Metrics
                        initialCount: initialSelectedCount,
                        matchedFromList: matchedFiles.size,
                        finalCount: finalSelectedCount,
                        addedCount: addedCount,
                        unmatchedCount: unmatchedPatterns.length
                    }
                );
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error processing file list: ${message}`);
            telemetryService.sendTelemetryException(error instanceof Error ? error : new Error(String(error)));
        }
    });

     // Register command to get help content
    const getHelpContentCommand = vscode.commands.registerCommand('promptcode.getHelpContent', async () => {
        try {
            const helpFilePath = path.join(context.extensionPath, 'help.md');
            if(fs.existsSync(helpFilePath)) {
                const content = await fs.promises.readFile(helpFilePath, 'utf8');
                return content;
            } else {
                return 'Help file not found.';
            }
        } catch (error) {
            console.error('Error reading help file:', error);
            return 'Could not load help content.';
        }
    });
    // --- END ADDED ---

    // --- ADDED: Command to process pasted file list --- 
    const processPastedFileListCommand = vscode.commands.registerCommand('promptcode.processPastedFileList', async (content: string) => {
        try {
            // Get current selection
            const currentSelection = new Set<string>();
            for (const [path, isChecked] of checkedItems.entries()) {
                if (isChecked) {
                    currentSelection.add(path);
                }
            }
            const initialSelectedCount = currentSelection.size;

            const currentWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!currentWorkspaceRoot) {
                throw new Error('No active workspace folder found.');
            }

            const currentIgnoreHelper = fileExplorerProvider.getIgnoreHelper();
            if (!currentIgnoreHelper) {
                // Don't throw, allow proceeding without ignore filtering if helper isn't ready
                console.warn('Ignore helper not initialized during list processing.');
                // throw new Error('Ignore helper not initialized.'); 
            }

            const processor = new FileListProcessor(currentWorkspaceRoot, currentIgnoreHelper);
            const { matchedFiles, unmatchedPatterns } = await processor.processList(content);

            // Combine current selection with newly matched files
            const combinedSelection = new Set<string>([...currentSelection, ...matchedFiles]);

            // Update the file explorer's checked items using the combined set
            // setCheckedItems will handle ignore rules and validation internally
            await fileExplorerProvider.setCheckedItems(combinedSelection);

            // Get the final count AFTER setCheckedItems has run (it might filter some)
            const finalSelectedCount = Array.from(checkedItems.values()).filter(Boolean).length;
            const addedCount = finalSelectedCount - initialSelectedCount;

            // Send unmatched patterns back to the webview regardless
            if (promptCodeProvider._panel) {
                // Send the count of *actually* newly matched/added files
                promptCodeProvider.sendUnmatchedPatterns(unmatchedPatterns, Math.max(0, addedCount)); 
            }

            // Notify user based on the outcome
            let notificationMessage = '';
            if (addedCount > 0) {
                notificationMessage = `Processed pasted list: Added ${addedCount} file(s). Total selected: ${finalSelectedCount}. ${unmatchedPatterns.length} pattern(s) didn't match.`;
            } else if (matchedFiles.size > 0 && addedCount <= 0) {
                // Matched some files, but filtering/duplicates meant no *net* increase
                notificationMessage = `Processed pasted list: Selection updated. Total selected: ${finalSelectedCount}. ${unmatchedPatterns.length} pattern(s) didn't match.`;
            } else { 
                // No new files matched from the list
                notificationMessage = `Processed pasted list: No new matching files found. Total selected: ${finalSelectedCount}. ${unmatchedPatterns.length} pattern(s) didn't match.`;
            }
            vscode.window.showInformationMessage(notificationMessage);

            // Send combined telemetry
            telemetryService.sendTelemetryEvent('list_processed_combined', 
                { source: 'paste' }, // Properties (strings)
                { // Metrics (numbers)
                    initialCount: initialSelectedCount,
                    matchedFromList: matchedFiles.size,
                    finalCount: finalSelectedCount,
                    addedCount: addedCount,
                    unmatchedCount: unmatchedPatterns.length
                }
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error processing pasted list: ${message}`);
            telemetryService.sendTelemetryException(error instanceof Error ? error : new Error(String(error)));
        }
    });
    // --- END ADDED ---

	// Register all commands
	const commandHandlers = {
		'promptcode.showFileSelector': () => promptCodeProvider.showWebView(),
		'promptcode.showPromptCodeView': () => promptCodeProvider.showWebView(),
		// 'promptcode.generatePrompt': generatePrompt, // generatePrompt command already registered above
		'promptcode.selectAll': selectAllCommand,
		'promptcode.deselectAll': deselectAllCommand,
		'promptcode.copyToClipboard': copyToClipboardCommand,
		'promptcode.clearTokenCache': clearTokenCacheCommand,
		'promptcode.refreshFileExplorer': refreshFileExplorerCommand,
		'promptcode.copyFilePath': copyFilePathCommand,
		'promptcode.copyRelativeFilePath': copyRelativeFilePathCommand,
		'promptcode.openFileInEditor': openFileInEditorCommand,
		// Add a new debug command for telemetry status
		'promptcode.checkTelemetryStatus': () => {
			const status = TelemetryService.getInstance().getTelemetryStatus();
			vscode.window.showInformationMessage('Telemetry Status', { modal: true, detail: status });
			console.log('[DEBUG] Telemetry status report:');
			console.log(status);
			return status;
		},
        // --- ADDED ---
        'promptcode.loadAndProcessFileList': loadAndProcessFileListCommand,
        'promptcode.getHelpContent': getHelpContentCommand,
        'promptcode.processPastedFileList': processPastedFileListCommand, // Register the new handler
        // --- END ADDED ---
	};

	context.subscriptions.push(
		showPromptCodeViewCommand,
		filterFilesCommand,
		selectAllCommand,
		deselectAllCommand,
		expandAllCommand,
		collapseAllCommand,
		showFileSelectorCommand,
		generatePromptCommand,
		generatePromptPreviewCommand,
		copyToClipboardCommand,
		copyPromptDirectlyCommand,
		applyMergeCommand,
		replaceCodeCommand,
		saveIgnoreConfigCommand,
		savePromptsConfigCommand,
		loadIgnoreConfigCommand,
		loadPromptsConfigCommand,
		getSelectedFilesCommand,
		deselectFileCommand,
		removeDirectoryCommand,
		copyFilePathCommand,
		copyRelativeFilePathCommand,
		clearTokenCacheCommand,
		refreshFileExplorerCommand,
		openFileInEditorCommand,
		showNewContentCommand,
		showDiffCommand,
		debugRefreshSelectedFilesCommand,
		vscode.commands.registerCommand('promptcode.checkTelemetryStatus', commandHandlers['promptcode.checkTelemetryStatus']),
        // --- ADDED ---
        loadAndProcessFileListCommand,
        getHelpContentCommand,
        processPastedFileListCommand // Add the new command to subscriptions
        // --- END ADDED ---
	);
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Send final telemetry event before deactivation
	const telemetryService = TelemetryService.getInstance();
	telemetryService.sendTelemetryEvent('extension_deactivated');
}

// Helper function to validate includeOptions
function isValidIncludeOptions(options: any): options is { files: boolean; instructions: boolean } {
	return options &&
	       typeof options === 'object' &&
	       'files' in options &&
	       'instructions' in options &&
	       typeof options.files === 'boolean' &&
	       typeof options.instructions === 'boolean';
}

// Helper function to generate prompt
async function generatePrompt(
	selectedFiles: {
		path: string;
		tokenCount: number;
		workspaceFolderRootPath?: string;
		absolutePath?: string;
		workspaceFolderName?: string;
	}[],
	instructions: string,
	includeOptions: { files: boolean; instructions: boolean }
): Promise<string> {
	// ... (implementation remains the same) ...
    const startTime = performance.now();

	// If files are not to be included and no instructions, return empty string
	if (!includeOptions.files && (!instructions || !includeOptions.instructions)) {
		const endTime = performance.now();
		console.log(`Prompt generation1 took ${endTime - startTime}ms for ${selectedFiles.length} files`);
		return '';
	}

	// If no files are selected but we have instructions
	if (selectedFiles.length === 0 && instructions && includeOptions.instructions) {
		const endTime = performance.now();
		console.log(`Prompt generation2 took ${endTime - startTime}ms for ${selectedFiles.length} files`);
		return instructions;
	}

    let prompt = '';

	// --- File Tree Generation ---
    if (includeOptions.files && selectedFiles.length > 0) {
        prompt += '<file_tree>\n';
        const treeStructure: { [root: string]: any } = {};
        const workspaceFolders = vscode.workspace.workspaceFolders || [];

        // Initialize tree structure for each workspace root involved
        selectedFiles.forEach(file => {
            const workspaceRoot = file.workspaceFolderRootPath || "unknown_root";
            if (!treeStructure[workspaceRoot]) {
                treeStructure[workspaceRoot] = {};
            }
        });

        // Build the tree for each selected file
        for (const file of selectedFiles) {
            const workspaceRoot = file.workspaceFolderRootPath || "unknown_root";
            const parts = file.path.split(path.sep);
            let currentLevel = treeStructure[workspaceRoot];

            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!currentLevel[part]) {
                    currentLevel[part] = {};
                }
                currentLevel = currentLevel[part];
            }
            const fileName = parts[parts.length - 1];
            currentLevel[fileName] = true; // Mark as file
        }

        // Function to render the tree
        const renderTree = (node: any, indent: string = '', isLast: boolean = true): string => {
            let output = '';
            const keys = Object.keys(node).sort((a, b) => {
                // Sort directories before files, then alphabetically
                const aIsDir = typeof node[a] === 'object';
                const bIsDir = typeof node[b] === 'object';
                if (aIsDir && !bIsDir) return -1;
                if (!aIsDir && bIsDir) return 1;
                return a.localeCompare(b);
            });

            keys.forEach((key, index) => {
                const currentIsLast = index === keys.length - 1;
                const connector = currentIsLast ? '└── ' : '├── ';
                const isDir = typeof node[key] === 'object';

                output += `${indent}${connector}${key}${isDir ? '/' : ''}\n`;

                if (isDir) {
                    const newIndent = indent + (currentIsLast ? '    ' : '│   ');
                    output += renderTree(node[key], newIndent, currentIsLast);
                }
            });
            return output;
        };

        // Render tree for each workspace root
        Object.keys(treeStructure).forEach(rootPath => {
            const workspaceName = workspaceFolders.find(f => f.uri.fsPath === rootPath)?.name || path.basename(rootPath);
            prompt += `${workspaceName}/\n`; // Use workspace name or root folder name
            prompt += renderTree(treeStructure[rootPath], '');
            prompt += '\n';
        });


        prompt += '</file_tree>\n\n';
    }
    // --- End File Tree Generation ---


	// Get file contents only if files are to be included
	const fileContents = includeOptions.files ? await Promise.all(selectedFiles.map(async file => {
		try {
			let absolutePath: string;

			// Use the file's absolutePath if available
			if (file.absolutePath) {
				absolutePath = file.absolutePath;
			}
			// Use the file's specific workspace folder root path if available
			else if (file.workspaceFolderRootPath) {
				absolutePath = path.join(file.workspaceFolderRootPath, file.path);
			}
			// Fallback to trying to resolve relative path if absolute doesn't work
            else if(path.isAbsolute(file.path)) {
                 absolutePath = file.path;
            }
            else {
                // Last resort: assume relative to first workspace folder
                const firstWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!firstWorkspaceRoot) {
                    throw new Error('Cannot resolve file path: No workspace folder is open and path is relative.');
                }
                absolutePath = path.join(firstWorkspaceRoot, file.path);
                 if (!fs.existsSync(absolutePath)) {
                     throw new Error(`Cannot resolve file path: Tried joining relative path "${file.path}" with first workspace root, but file not found.`);
                 }
            }


			const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
			return {
				path: file.path, // Keep original relative path for display
                fullPath: absolutePath,
                content: content.toString(),
				tokenCount: file.tokenCount,
                workspaceFolderName: file.workspaceFolderName,
                workspaceFolderRootPath: file.workspaceFolderRootPath,
                relPath: file.path // Use the original relative path here
			};
		} catch (error) {
			console.error(`Error reading file ${file.path}:`, error);
			return null;
		}
	})) : [];

	// Filter out failed reads
	const validFiles = fileContents.filter((file): file is NonNullable<typeof file> => file !== null);


	// Add file contents section only if files are to be included and there are valid files
	if (includeOptions.files && validFiles.length > 0) {
		prompt += '<files>\n';
		for (const file of validFiles) {
            // Determine file extension for syntax highlighting hint
            const ext = path.extname(file.path).substring(1);

			prompt += `workspace_name: ${file.workspaceFolderName || 'Unknown'}\n`;
			prompt += `workspace_root: ${file.workspaceFolderRootPath || 'Unknown'}\n`;
			prompt += `rel_path: ${file.relPath}\n`; // Use the calculated relative path
			prompt += `full_filepath: ${file.fullPath}\n`; // Use the resolved absolute path
            prompt += `\`\`\`${ext}\n${file.content}\n\`\`\`\n\n`; // Use backticks with lang hint
		}
		prompt += '</files>';
	}

	// Add instructions if they exist and are to be included
	if (instructions?.trim() && includeOptions.instructions) {
		if (prompt) {
			prompt += '\n';
		}
		prompt += '<user_instructions>\n';
		prompt += instructions.trim();
		prompt += '\n</user_instructions>\n';
	}

	const endTime = performance.now();
	console.log(`Prompt generation took ${endTime - startTime}ms for ${validFiles.length} files`);

	return prompt;
}

// Helper function to get selected files with content
async function getSelectedFilesWithContent(): Promise<SelectedFile[]> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		// Allow returning empty if no workspace, might still generate prompt with only instructions
        // throw new Error('No workspace folder is open');
        console.log("No workspace folder open, returning empty selected files.");
        return [];
	}

	// Get all checked items
	const selectedFilePaths = Array.from(checkedItems.entries())
		.filter(([_, isChecked]) => isChecked)
		.map(([filePath, _]) => filePath)
		.filter(filePath => {
			try {
                if (!fs.existsSync(filePath)) return false; // Ensure file exists
				return fs.statSync(filePath).isFile();
			} catch (error) {
                console.warn(`Error stating file, skipping: ${filePath}`, error);
				return false;
			}
		});

	// Get file contents and token counts
	const selectedFilesPromises = selectedFilePaths.map(async (absolutePath): Promise<SelectedFile> => { // Ensure the map returns a Promise<SelectedFile>
		// Find which workspace folder this file belongs to
		let workspaceFolderName: string | undefined = undefined;
		let workspaceFolderRootPath: string | undefined = undefined;
		let relativePath = absolutePath; // Default to absolute if not in workspace

		const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absolutePath));
		if (folder) {
			workspaceFolderName = folder.name;
			workspaceFolderRootPath = folder.uri.fsPath;
			relativePath = path.relative(workspaceFolderRootPath, absolutePath);
		}

		// If still undefined, try to find the *closest* workspace folder if multiple exist
		if (!workspaceFolderRootPath && vscode.workspace.workspaceFolders) {
			let bestMatch: vscode.WorkspaceFolder | undefined;
			let maxOverlap = -1;

			vscode.workspace.workspaceFolders.forEach(wsFolder => {
				if (absolutePath.startsWith(wsFolder.uri.fsPath)) {
					const overlap = wsFolder.uri.fsPath.length;
					if (overlap > maxOverlap) {
						maxOverlap = overlap;
						bestMatch = wsFolder;
					}
				}
			});

			if (bestMatch) {
				workspaceFolderName = bestMatch.name;
				workspaceFolderRootPath = bestMatch.uri.fsPath;
				relativePath = path.relative(workspaceFolderRootPath, absolutePath);
			}
		}

		const tokenCount = await countTokensWithCache(absolutePath);

		// Return an object matching the SelectedFile type
		return {
			path: relativePath,
			absolutePath,
			tokenCount,
			workspaceFolderName: workspaceFolderName || 'Unknown Workspace', // Provide default string
			workspaceFolderRootPath: workspaceFolderRootPath || '', // Provide default string
		};
	});

	const selectedFiles = await Promise.all(selectedFilesPromises);

	return selectedFiles;
}

// --- Save to file feature --- (Modified)
/**
 * Saves the provided prompt text to a file chosen by the user,
 * remembering the last used location.
 * @param prompt The string content of the prompt to save.
 */
export async function savePromptToFile(prompt: string) {
    // Determine the default URI: use the last saved one, or the default filename
    const defaultUri = lastSaveUri instanceof vscode.Uri 
        ? lastSaveUri 
        : vscode.Uri.file('promptcode-output.txt');

    const uri = await vscode.window.showSaveDialog({
        title: 'Save generated prompt',
        defaultUri: defaultUri,
        filters: { Text: ['txt'], Markdown: ['md'] }
    });

    if (!uri) { 
        console.log('User cancelled save dialog.');
        return; // User cancelled
    }

    try {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(prompt, 'utf8'));
        vscode.window.showInformationMessage(`Prompt saved to ${uri.fsPath}`);
        
        // Remember this URI for the next time
        lastSaveUri = uri; 

        // Optional: Add telemetry here
        // ... telemetry code ...
    } catch (error: any) {
        console.error(`Error writing file ${uri.fsPath}:`, error);
        vscode.window.showErrorMessage(`Failed to save prompt to file: ${error.message || 'Unknown error'}`);
        // Optional: Add error telemetry
        // ... error telemetry code ...
    }
}
// --- End Save to file feature ---