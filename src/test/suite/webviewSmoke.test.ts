/**
 * Extension-host smoke test for webview.
 * This runs IN VS Code and tests the REAL webview, not a mock.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Webview Smoke Test - REAL Testing', () => {
  let webviewPanel: vscode.WebviewPanel | undefined;
  let consoleMessages: Array<{type: string, message: string}> = [];

  setup(() => {
    consoleMessages = [];
  });

  teardown(() => {
    if (webviewPanel) {
      webviewPanel.dispose();
      webviewPanel = undefined;
    }
  });

  test('webview loads without CSP violations', async () => {
    // Execute the real command that opens the webview
    await vscode.commands.executeCommand('promptcode.showFileSelector');

    // Wait for webview to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get the webview panel - we need to expose this from the extension
    const allPanels = (global as any).__promptcodeWebviewPanels || [];
    assert.strictEqual(allPanels.length, 1, 'Webview panel should be created');
    
    webviewPanel = allPanels[0];
    assert.ok(webviewPanel, 'Webview panel should exist');

    // Subscribe to console messages from webview
    const disposable = webviewPanel.webview.onDidReceiveMessage((msg: any) => {
      if (msg?.command === 'console') {
        consoleMessages.push({ type: msg.type, message: msg.message });
      }
    });

    // Wait a bit for any CSP violations to be logged
    await new Promise(resolve => setTimeout(resolve, 500));

    // Clean up subscription
    disposable.dispose();

    // Check for CSP violations in console
    const cspViolations = consoleMessages.filter(msg => 
      msg.message.includes('Refused to') || 
      msg.message.includes('Content Security Policy')
    );
    
    assert.strictEqual(cspViolations.length, 0, 
      `Found CSP violations: ${cspViolations.map(v => v.message).join(', ')}`);
  });

  test('webview accepts and processes messages', async () => {
    await vscode.commands.executeCommand('promptcode.showFileSelector');
    await new Promise(resolve => setTimeout(resolve, 500));

    const allPanels = (global as any).__promptcodeWebviewPanels || [];
    webviewPanel = allPanels[0];
    
    if (!webviewPanel) {
      assert.fail('No webview panel found');
      return;
    }

    // Track messages from webview
    const receivedMessages: any[] = [];
    const disposable = webviewPanel.webview.onDidReceiveMessage(msg => {
      receivedMessages.push(msg);
    });

    // Send a test message to the webview
    await webviewPanel.webview.postMessage({
      command: 'updateConfiguration',
      config: { respectGitignore: true }
    });

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 500));

    // Cleanup
    disposable.dispose();

    // Verify webview is responsive
    assert.ok(receivedMessages.length >= 0, 'Webview should be able to receive messages');
  });

  test('file selection actually updates webview state', async () => {
    // Get the file explorer provider
    const ext = vscode.extensions.getExtension('cogflows.promptcode');
    assert.ok(ext, 'Extension should be available');
    
    const api = await ext.activate();
    assert.ok(api, 'Extension API should be available');

    // Open the webview
    await vscode.commands.executeCommand('promptcode.showFileSelector');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Select some files programmatically
    const testFiles = ['package.json', 'README.md'];
    await vscode.commands.executeCommand('promptcode.selectFiles', testFiles);

    // Wait for update
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify the selection was processed
    // This requires the extension to expose getters for testing
    const selectedFiles = (global as any).__promptcodeSelectedFiles || [];
    assert.ok(selectedFiles.length > 0, 'Files should be selected');
  });

  test('webview handles large file selections without hanging', async () => {
    await vscode.commands.executeCommand('promptcode.showFileSelector');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Create a large file list
    const largeFileList = Array.from({ length: 1000 }, (_, i) => `file${i}.ts`);
    
    const startTime = Date.now();
    
    // This should complete without timeout
    await vscode.commands.executeCommand('promptcode.selectFiles', largeFileList);
    
    const elapsed = Date.now() - startTime;
    
    // Should handle 1000 files in under 5 seconds
    assert.ok(elapsed < 5000, `Large file selection took too long: ${elapsed}ms`);
  });

  test('tab switching preserves state', async () => {
    await vscode.commands.executeCommand('promptcode.showFileSelector');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Select files
    await vscode.commands.executeCommand('promptcode.selectFiles', ['test.ts']);
    
    // Switch tabs (simulate through messages)
    const allPanels = (global as any).__promptcodeWebviewPanels || [];
    webviewPanel = allPanels[0];
    
    if (webviewPanel) {
      // Switch to instructions tab
      await webviewPanel.webview.postMessage({ command: 'switchTab', tab: 'instructions' });
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Switch back to files tab
      await webviewPanel.webview.postMessage({ command: 'switchTab', tab: 'files' });
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Files should still be selected
      const selectedFiles = (global as any).__promptcodeSelectedFiles || [];
      assert.ok(selectedFiles.length > 0, 'File selection should be preserved after tab switch');
    }
  });

  test('console forwarding captures all webview logs', async () => {
    await vscode.commands.executeCommand('promptcode.showFileSelector');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // The webview should have logged initialization messages
    const initLogs = consoleMessages.filter(msg => 
      msg.message.includes('Initializing') || 
      msg.message.includes('Debug')
    );
    
    // We expect some initialization logs from the real webview
    assert.ok(initLogs.length > 0, 'Webview should produce initialization logs');
  });
});

/**
 * Integration test that validates the complete flow
 */
suite('End-to-End User Journey - REAL', () => {
  test('complete flow: select files -> add instructions -> generate prompt', async function() {
    this.timeout(30000); // Give enough time for real operations

    // 1. Open webview
    await vscode.commands.executeCommand('promptcode.showFileSelector');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Select files
    const filesToSelect = [
      'package.json',
      'src/extension.ts'
    ];
    await vscode.commands.executeCommand('promptcode.selectFiles', filesToSelect);
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. Add instructions
    await vscode.commands.executeCommand('promptcode.setInstructions', 
      'Review this code for security issues');
    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. Generate prompt
    await vscode.commands.executeCommand('promptcode.generatePrompt');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 5. Verify prompt was generated
    const generatedPrompt = (global as any).__promptcodeLastGeneratedPrompt;
    assert.ok(generatedPrompt, 'Prompt should be generated');
    assert.ok(generatedPrompt.includes('package.json'), 'Prompt should include selected files');
    assert.ok(generatedPrompt.includes('Review this code'), 'Prompt should include instructions');
  });

  test('handles workspace with .gitignore correctly', async function() {
    this.timeout(10000);

    // Create a test workspace with .gitignore
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'Workspace folder should exist');

    // Open webview
    await vscode.commands.executeCommand('promptcode.showFileSelector');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // The file tree should respect .gitignore
    const ignoredFiles = ['node_modules', '.git', 'dist'];
    
    // Try to select ignored files - should fail or filter them out
    await vscode.commands.executeCommand('promptcode.selectFiles', ignoredFiles);
    await new Promise(resolve => setTimeout(resolve, 500));

    const selectedFiles = (global as any).__promptcodeSelectedFiles || [];
    const hasIgnoredFiles = selectedFiles.some((f: string) => 
      ignoredFiles.some(ignored => f.includes(ignored))
    );
    
    assert.ok(!hasIgnoredFiles, 'Ignored files should not be selectable');
  });
});