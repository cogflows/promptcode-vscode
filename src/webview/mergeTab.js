// Define initMergeTab in the global scope immediately
(function() {
  // Define the function in the window scope
  window.initMergeTab = function(vscode) {
    /**
     * Initializes all logic for the "Merge" tab, including:
     *  - The merge textarea for model responses
     *  - Parsing XML code changes from the textarea
     *  - Displaying the parsed changes for review
     *  - Apply functionality to replace code in the editor
     */
    
    // Get DOM elements
    const mergeTextarea = document.getElementById('merge-textarea');
    const applyButton = document.getElementById('apply-merge-btn');
    
    // Create a container for displaying parsed changes
    const mergeContentDiv = document.querySelector('.merge-content');
    if (mergeContentDiv) {
      const fileChangesEl = document.createElement('div');
      fileChangesEl.className = 'file-changes-container';
      fileChangesEl.id = 'file-changes-container';
      fileChangesEl.style.display = 'none';
      mergeContentDiv.insertBefore(fileChangesEl, mergeTextarea);
    }
    
    // Initialize the textarea and event listeners
    if (mergeTextarea) {
      mergeTextarea.addEventListener('input', debounce(() => {
        // For now, just save the content locally
        const content = mergeTextarea.value;
        saveToLocalStorage('mergeContent', content);
      }, 500));

      // Load any previously saved content
      const savedContent = getFromLocalStorage('mergeContent');
      if (savedContent) {
        mergeTextarea.value = savedContent;
      }
    }

    // Handle the Apply button
    if (applyButton) {
      // Define a reusable apply function
      const handleApply = () => {
        const content = mergeTextarea.value;
        if (content) {
          // Parse the XML content and display the file changes
          parseAndDisplayChanges(content);
          
          // Signal the extension about the merge action
          vscode.postMessage({
            command: 'applyMerge',
            content: content
          });
          
          // Change the Apply button to become a Back button
          applyButton.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5"></path>
              <path d="M12 19l-7-7 7-7"></path>
            </svg>
            Back to Text Input
          `;
          
          // Change the function of the button to go back to text input
          applyButton.removeEventListener('click', handleApply);
          applyButton.addEventListener('click', handleBack);
        }
      };
      
      // Define the back function
      const handleBack = () => {
        // Show the textarea and hide the file changes container
        mergeTextarea.style.display = 'block';
        const fileChangesContainer = document.getElementById('file-changes-container');
        if (fileChangesContainer) {
          fileChangesContainer.style.display = 'none';
        }
        
        // Reset the button back to "Apply & Review"
        applyButton.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 16l-4-4 4-4"></path>
            <path d="M8 12h12"></path>
            <path d="M8 20V4"></path>
          </svg>
          Apply & Review
        `;
        
        // Reset the click listener
        applyButton.removeEventListener('click', handleBack);
        applyButton.addEventListener('click', handleApply);
      };
      
      // Initial setup with the apply handler
      applyButton.addEventListener('click', handleApply);
    }
    
    /**
     * Parses the XML content from the textarea and displays the changes
     * @param {string} content - The content from the textarea
     */
    function parseAndDisplayChanges(content) {
      let xmlContent = '';
      
      // Try to extract XML from markdown code fence first
      const xmlRegex = /```xml\s*([\s\S]*?)\s*```/;
      const xmlMatch = content.match(xmlRegex);
      
      if (xmlMatch && xmlMatch[1]) {
        // If we found XML in code fences, use that
        xmlContent = xmlMatch[1];
      } else {
        // Otherwise, try to find direct XML content
        // First look for <code_changes> tag
        const directXmlRegex = /<code_changes>[\s\S]*?<\/code_changes>/;
        const directXmlMatch = content.match(directXmlRegex);
        
        if (directXmlMatch) {
          xmlContent = directXmlMatch[0];
        } else {
          // As a last resort, check if there are any XML tags at all
          const anyXmlRegex = /<\w+>[\s\S]*?<\/\w+>/;
          const anyXmlMatch = content.match(anyXmlRegex);
          
          if (anyXmlMatch) {
            // Found some XML tags, but not the expected <code_changes>
            showError('Found XML content but missing <code_changes> wrapper tags. Please check the format.');
          } else {
            // No XML tags found at all
            showError('No XML content found in the response. Please ensure your input contains proper XML.');
          }
          return;
        }
      }
      
      // Parse the XML content
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
        
        // Check for parsing errors
        const parseError = xmlDoc.querySelector("parsererror");
        if (parseError) {
          // Extract the error message for better feedback
          const errorMsg = parseError.textContent || 'Failed to parse XML content';
          showError(`XML parsing error: ${errorMsg}`);
          return;
        }
        
        // Make sure the XML has the expected structure
        const codeChanges = xmlDoc.querySelector('code_changes');
        if (!codeChanges) {
          showError('Missing <code_changes> tag in the XML');
          return;
        }
        
        const changedFiles = codeChanges.querySelector('changed_files');
        if (!changedFiles) {
          showError('Missing <changed_files> tag in the XML');
          return;
        }
        
        // Get all file elements
        const fileElements = changedFiles.querySelectorAll('file');
        
        // If no files found in the expected structure, try looking anywhere in the document
        if (fileElements.length === 0) {
          const allFileElements = xmlDoc.querySelectorAll('file');
          
          if (allFileElements.length > 0) {
            // Found file elements but they're not in the expected location
            console.warn('File elements found but not properly nested under <changed_files>');
            showFilesUI(allFileElements);
            return;
          } else {
            showError('No file changes found in the XML');
            return;
          }
        } else {
          // Use the properly structured file elements
          showFilesUI(fileElements);
        }
      } catch (error) {
        console.error('Error parsing XML:', error);
        showError('Failed to parse the response: ' + error.message);
      }
    }
    
    /**
     * Displays the file changes UI with the given file elements
     * @param {NodeList} fileElements - The file elements from the XML
     */
    function showFilesUI(fileElements) {
      // Clear and show the file changes container
      const fileChangesContainer = document.getElementById('file-changes-container');
      console.log('File changes container:', fileChangesContainer);
      fileChangesContainer.innerHTML = '';
      fileChangesContainer.style.display = 'block';
      
      // Create a header for the changes list
      const header = document.createElement('div');
      header.className = 'file-changes-header';
      header.innerHTML = `
        <h3>File Changes (${fileElements.length})</h3>
        <div class="button-group">
          <button class="apply-all-btn">Apply All</button>
        </div>
      `;
      fileChangesContainer.appendChild(header);
      console.log('Added header to container');
      
      // Add event listener to the Apply All button
      const applyAllButton = header.querySelector('.apply-all-btn');
      if (applyAllButton) {
        applyAllButton.addEventListener('click', async () => {
          const fileItems = fileChangesContainer.querySelectorAll('.file-change-item');
          for (const item of fileItems) {
            const replaceButton = item.querySelector('.replace-code-btn');
            if (replaceButton) {
              // Get the file details from the item's dataset
              const filePath = item.dataset.filePath;
              const fileOperation = item.dataset.fileOperation;
              const fileCode = item.dataset.fileCode;
              const workspaceName = item.dataset.workspaceName;
              const workspaceRoot = item.dataset.workspaceRoot;
              
              // Send message to extension to replace code
              vscode.postMessage({
                command: 'replaceCode',
                filePath,
                fileOperation,
                fileCode,
                workspaceName,
                workspaceRoot
              });
              
              // Wait a short delay to allow the operation to complete
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        });
      }
      
      // Process each file element
      Array.from(fileElements).forEach((fileEl, index) => {
        // Extract data from the XML
        const fileSummary = getElementTextContent(fileEl, 'file_summary');
        const fileOperation = getElementTextContent(fileEl, 'file_operation');
        const filePath = getElementTextContent(fileEl, 'file_path');
        const fullFilePath = getElementTextContent(fileEl, 'full_file_path');
        const workspaceName = getElementTextContent(fileEl, 'workspace_name');
        const workspaceRoot = getElementTextContent(fileEl, 'workspace_root');
        const fileCode = getElementCData(fileEl, 'file_code');
        
        console.log(`Processing file ${index}: ${filePath} (${fileOperation})`);
        
        // Create the file change item
        const fileItem = document.createElement('div');
        fileItem.className = 'file-change-item';
        fileItem.dataset.index = index;
        fileItem.dataset.filePath = filePath;
        fileItem.dataset.fileOperation = fileOperation;
        fileItem.dataset.workspaceName = workspaceName;
        fileItem.dataset.workspaceRoot = workspaceRoot;
        
        // Get operation label and button text based on operation type
        const operationLabel = fileOperation.toUpperCase();
        let replaceButtonText = 'Apply';
        // Always show diff button for all operations
        let shouldShowDiffButton = true;
        
        // Create display path with workspace information
        let displayPath = filePath;
        if (workspaceName) {
          displayPath = `${workspaceName}: ${filePath}`;
        }
        
        // Updated HTML structure with operation label and conditional buttons
        fileItem.innerHTML = `
          <div class="file-change-header">
            <div class="file-path">${displayPath} <span class="file-operation ${fileOperation.toLowerCase()}">${operationLabel}</span></div>
          </div>
          <div class="file-summary">${fileSummary}</div>
          <div class="file-buttons">
            ${shouldShowDiffButton ? `<button class="show-diff-btn" data-file-path="${filePath}">Show Diff</button>` : ''}
            <button class="replace-code-btn" data-file-path="${filePath}" data-file-operation="${fileOperation}">${replaceButtonText}</button>
          </div>
        `;
        
        // Store the file code in a data attribute
        fileItem.dataset.fileCode = fileCode;
        
        // Add the file item to the container
        fileChangesContainer.appendChild(fileItem);
        console.log(`Added file item ${index} to container`);
        
        // Get the buttons after they're added to the DOM
        const replaceButton = fileItem.querySelector('.replace-code-btn');
        const showDiffButton = fileItem.querySelector('.show-diff-btn');
        
        // Add click handlers for the buttons
        if (replaceButton) {
          replaceButton.addEventListener('click', () => {
            // Send message to extension to replace code
            vscode.postMessage({
              command: 'replaceCode',
              filePath: filePath,
              fileOperation: fileOperation,
              fileCode: fileCode,
              workspaceName: workspaceName,
              workspaceRoot: workspaceRoot
            });
          });
        }
        
        if (showDiffButton) {
          showDiffButton.addEventListener('click', () => {
            // Show diff in a new tab
            vscode.postMessage({
              command: 'showDiff',
              filePath: filePath,
              fileCode: fileCode,
              fileOperation: fileOperation,
              workspaceName: workspaceName,
              workspaceRoot: workspaceRoot
            });
          });
        }
      });
      
      // Hide the textarea
      mergeTextarea.style.display = 'none';
    }
    
    /**
     * Get text content of an element
     */
    function getElementTextContent(parentEl, tagName) {
      const el = parentEl.getElementsByTagName(tagName)[0];
      return el ? el.textContent : '';
    }
    
    /**
     * Get CDATA content of an element
     */
    function getElementCData(parentEl, tagName) {
      const el = parentEl.getElementsByTagName(tagName)[0];
      if (!el) {return '';}
      
      // Look for CDATA section
      for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i];
        if (node.nodeType === 4) { // CDATA_SECTION_NODE
          return node.nodeValue;
        }
      }
      
      // Fallback to regular text content if no CDATA
      return el.textContent;
    }
    
    /**
     * Show an error message
     */
    function showError(message) {
      const fileChangesContainer = document.getElementById('file-changes-container');
      if (fileChangesContainer) {
        fileChangesContainer.innerHTML = `
          <div class="error-message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <p>${message}</p>
          </div>
        `;
        fileChangesContainer.style.display = 'block';
      }
    }

    // Message handling from the extension
    window.mergeTab = {
      onMessage: function(message) {
        console.log('mergeTab received message:', message);
        if (message.command === 'updateMergeContent') {
          if (mergeTextarea) {
            mergeTextarea.value = message.content;
            saveToLocalStorage('mergeContent', message.content);
          }
        } else if (message.command === 'codeReplaced') {
          // Handle confirmation of code replacement
          const { filePath, displayPath, success, fileOperation } = message;
          console.log('Received codeReplaced message:', { filePath, displayPath, success, fileOperation });
          
          // Find all buttons with this file path
          const buttons = document.querySelectorAll(`.replace-code-btn[data-file-path="${filePath}"]`);
          console.log('Found buttons:', buttons.length);
          
          buttons.forEach(button => {
            if (success) {
              console.log('Updating button to success state');
              button.textContent = 'Applied';
              button.disabled = true;
              button.classList.remove('error');
              button.classList.add('success');
              
              // Update file path display if needed and a display path is provided
              if (displayPath && displayPath !== filePath) {
                const fileItem = button.closest('.file-change-item');
                if (fileItem) {
                  const filePathEl = fileItem.querySelector('.file-path');
                  if (filePathEl) {
                    // Extract just the operation span
                    const opSpan = filePathEl.querySelector('.file-operation');
                    if (opSpan) {
                      // Replace the file path text but keep the operation span
                      filePathEl.textContent = '';
                      filePathEl.appendChild(document.createTextNode(displayPath + ' '));
                      filePathEl.appendChild(opSpan);
                    }
                  }
                }
              }
              
              // Disable the show-diff button
              const fileItem = button.closest('.file-change-item');
              if (fileItem) {
                const showDiffButton = fileItem.querySelector('.show-diff-btn');
                if (showDiffButton) {
                  showDiffButton.disabled = true;
                  showDiffButton.classList.add('disabled');
                }
              }
            } else {
              console.log('Updating button to error state');
              button.textContent = 'Failed';
              button.classList.add('error');
            }
          });
        }
      }
    };

    // Utility functions
    function saveToLocalStorage(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        console.error('Failed to save to localStorage:', e);
      }
    }

    function getFromLocalStorage(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        console.error('Failed to retrieve from localStorage:', e);
        return null;
      }
    }

    function debounce(fn, wait) {
      let timeout;
      return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          fn.apply(context, args);
        }, wait);
      };
    }

    // Add a console message to confirm the file was loaded
    console.log('mergeTab.js loaded and initMergeTab is now defined in window scope');

    // For debugging purposes only - will be automatically removed in production
    if (typeof TESTING !== 'undefined' && TESTING) {
      // Test the XML parser with different formats
      window._testXmlParser = function(format) {
        const directXml = `<code_changes>
<changed_files>
  <file>
    <file_summary>Test summary</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>test/path.js</file_path>
    <file_code><![CDATA[console.log("test");]]></file_code>
  </file>
</changed_files>
</code_changes>`;

        const codeFenceXml = "```xml\n" + directXml + "\n```";
        
        // Format 1: Direct XML
        if (format === 'direct') {
          console.log('Testing direct XML format:');
          parseAndDisplayChanges(directXml);
        }
        // Format 2: Code fence XML
        else if (format === 'fence') {
          console.log('Testing code fence XML format:');
          parseAndDisplayChanges(codeFenceXml);
        }
        // Both formats
        else {
          console.log('Testing both formats:');
          console.log('Direct XML result:');
          parseAndDisplayChanges(directXml);
          console.log('Code fence XML result:');
          parseAndDisplayChanges(codeFenceXml);
        }
      };
    }

    // Utility functions for workspace path handling
    function parseWorkspacePath(path) {
      // Always just use the absolute path directly
      return {
        relativePath: path,
        absolutePath: path,
        originalPath: path
      };
    }

    function formatDisplayPath(pathInfo) {
      // Just return the original path
      return pathInfo.originalPath;
    }
  };

  // Call this immediately to make sure the global object is defined
  console.log('mergeTab.js loaded and initMergeTab is now defined in window scope');
  
  // Try to notify any listeners that might be waiting
  if (window._scriptLoaded) {
    window._scriptLoaded.mergeTab = true;
  }

  // Add global styles to override default button widths
  const styleElement = document.createElement('style');
  styleElement.textContent = `
    /* Simple styles for file actions */
    .file-change-item {
      margin-bottom: 16px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
    }
    
    .file-change-header {
      background: var(--vscode-editor-inactiveSelectionBackground);
      padding: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    .file-path {
      font-family: monospace;
      word-break: break-all;
    }
    
    .file-summary {
      padding: 8px;
    }
    
    .file-buttons {
      padding: 8px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    
    .file-buttons button {
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
    }
    
    .show-diff-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
    }
    
    .replace-code-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }
    
    .replace-code-btn.success {
      background: #2d7d3a;
    }
    
    .replace-code-btn.error {
      background: #F44336;
    }
    
    .disabled {
      opacity: 0.5;
      cursor: not-allowed !important;
    }

    button:disabled {
      cursor: not-allowed !important;
    }
  `;
  document.head.appendChild(styleElement);
})(); 