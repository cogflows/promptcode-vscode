(function() {
  const vscode = acquireVsCodeApi();

  // Forward console logs to extension host
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  console.log = function(...args) {
      originalConsoleLog.apply(console, args);
      vscode.postMessage({
          command: 'console',
          type: 'log',
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
      });
  };

  console.error = function(...args) {
      originalConsoleError.apply(console, args);
      vscode.postMessage({
          command: 'console',
          type: 'error',
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
      });
  };

  console.warn = function(...args) {
      originalConsoleWarn.apply(console, args);
      vscode.postMessage({
          command: 'console',
          type: 'warn',
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
      });
  };

  // Initialize the Select Files tab functionality
  if (window.initSelectFilesTab) {
    window.initSelectFilesTab(vscode);
  } else {
    console.warn('initSelectFilesTab not found. Did you load selectFilesTab.js?');
  }

  // Initialize the Instructions tab functionality
  if (window.initInstructionsTab) {
    window.initInstructionsTab(vscode);
  } else {
    console.warn('initInstructionsTab not found. Did you load instructionsTab.js?');
  }

  // Initialize the Generate Prompt tab functionality
  if (window.initGeneratePromptTab) {
    window.initGeneratePromptTab(vscode);
  } else {
    console.warn('initGeneratePromptTab not found. Did you load generatePromptTab.js?');
  }

  // Initialize the Merge tab functionality
  console.log('Attempting to initialize Merge tab, initMergeTab exists:', !!window.initMergeTab);
  if (window.initMergeTab) {
    try {
      console.log('Calling initMergeTab function...');
      window.initMergeTab(vscode);
      console.log('Successfully initialized Merge tab');
    } catch (error) {
      console.error('Error initializing Merge tab:', error);
    }
  } else {
    console.warn('initMergeTab not found. Did you load mergeTab.js?');
  }

  // Get elements
  const searchInput = document.getElementById('file-search');
  const clearSearchBtn = document.getElementById('clear-search');
  const configHeader = document.getElementById('config-section-header');
  const configSection = document.getElementById('config-content');

  // Functions for file actions
  window.openFile = function(filePath, workspaceFolderRootPath) {
      console.log('openFile called with path:', filePath, 'workspace folder root path:', workspaceFolderRootPath);
      vscode.postMessage({ 
          command: 'openFile', 
          filePath: filePath,
          workspaceFolderRootPath: workspaceFolderRootPath 
      });
  };

  window.deselectFile = function(filePath, workspaceFolderRootPath) {
      vscode.postMessage({ 
          command: 'deselectFile', 
          filePath: filePath,
          workspaceFolderRootPath: workspaceFolderRootPath 
      });
  };

  window.directoryMap = window.directoryMap || {};

  // Attach event listener to selected-files-list for event delegation
  document.getElementById('selected-files-list')?.addEventListener('click', (event) => {
    // Find the closest trash button in the event path
    const trash = event.target.closest('.trash-btn');
    if (!trash) {return;} // Not a trash button click
    
    // Prevent propagation to avoid triggering other click handlers
    event.preventDefault();
    event.stopPropagation();
    
    const header = trash.closest('.directory-header');
    if (!header) {return;} // Not found in a directory header
    
    const dirId = header.dataset.dirId;
    if (!dirId) {return console.warn('No dirId found on directory header');}
    
    const dirPath = window.directoryMap[dirId];
    if (!dirPath) {return console.warn('Directory path not found in map for ID:', dirId);}
    
    // Use the ROOT_DIR_KEY for empty strings or the special root key
    const normalizedDirPath = dirPath === '__ROOT__' ? '' : dirPath;
    
    console.log('Removing directory via delegation:', normalizedDirPath);
    vscode.postMessage({
      command: 'removeDirectory',
      dirPath: normalizedDirPath
    });
  });

  // Initialize UI state
  function updateClearButtonVisibility() {
      if (searchInput.value) {
          clearSearchBtn.style.display = 'block';
      } else {
          clearSearchBtn.style.display = 'none';
      }
  }

  // Set initial state
  updateClearButtonVisibility();
  setTimeout(() => searchInput.focus(), 100);

  // Set initial config section state
  if (configSection) {
      configSection.style.display = 'none';
  }

  // Set initial checkbox and input states
  const respectGitignore = document.getElementById('respect-gitignore');
  const ignorePatterns = document.getElementById('ignore-patterns');
  if (respectGitignore) {
      respectGitignore.classList.add('checked');  // Default to checked
  }
  if (ignorePatterns) {
      // Set to read-only to show default patterns
      ignorePatterns.setAttribute('readonly', 'readonly');
      // Default patterns will be set by the extension
  }

  // Format token count to k format
  function formatTokenCount(count) {
      return (count / 1000).toFixed(2) + 'k';
  }

  // Track expanded directories
  let expandedDirectories = new Set();

  // Track view mode (folder or file)
  let viewMode = 'folder';  // Default to folder view

  // Function to truncate long filenames
  function truncateFilename(filename, maxLength = 20) {
      if (filename.length <= maxLength) {
          return filename;
      }
      const start = filename.substring(0, maxLength / 2 - 2);
      const end = filename.substring(filename.length - maxLength / 2 + 2);
      return start + '...' + end;
  }

  // Search input handling
  searchInput.addEventListener('input', function(event) {
      updateClearButtonVisibility();
      const searchTerm = event.target.value;
      
      // Set search term
      vscode.postMessage({
          command: 'search',
          searchTerm: searchTerm
      });
      
      // Add or remove active-filter class
      const searchContainer = document.querySelector('.search-container');
      if (searchTerm.trim()) {
          searchContainer?.classList.add('active-filter');
      } else {
          searchContainer?.classList.remove('active-filter');
          // Collapse all directories when search is cleared
          vscode.postMessage({ command: 'collapseAll' });
      }
  });

  // Clear button handling
  clearSearchBtn.addEventListener('click', function() {
      searchInput.value = '';
      clearSearchBtn.style.display = 'none';
      
      // Clear search term
      vscode.postMessage({
          command: 'search',
          searchTerm: ''
      });
      
      // Remove active filter class
      document.querySelector('.search-container')?.classList.remove('active-filter');
      
      // Collapse all directories when search is cleared
      vscode.postMessage({ command: 'collapseAll' });
      
      searchInput.focus();
  });
  
  // Initialize active filter display
  if (searchInput && searchInput.value.trim()) {
      document.querySelector('.search-container')?.classList.add('active-filter');
  }

  // Add event listeners for buttons
  document.getElementById('expand-all-btn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'expandAll' });
  });

  document.getElementById('collapse-all-btn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'collapseAll' });
  });

  document.getElementById('select-all-btn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'selectAll' });
  });

  document.getElementById('deselect-all-btn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'deselectAll' });
  });

  // Handle configuration
  const saveIgnoreBtn = document.getElementById('save-ignore-btn');

  if (respectGitignore && ignorePatterns && saveIgnoreBtn) {
      respectGitignore.addEventListener('click', function() {
          this.classList.toggle('checked');
      });

      // Only respect gitignore can be saved now
      saveIgnoreBtn.addEventListener('click', () => {
          vscode.postMessage({
              command: 'saveIgnoreConfig',
              // Use the current value without modification
              ignorePatterns: ignorePatterns.value,
              respectGitignore: respectGitignore.classList.contains('checked')
          });
      });

      vscode.postMessage({ command: 'loadIgnoreConfig' });
  }

  // Listen for extension => webview messages
  window.addEventListener('message', event => {
      const message = event.data;

      // Let the generatePromptTab handle relevant commands first
      if (window.generatePromptTab && typeof window.generatePromptTab.onMessage === 'function') {
        const handled = window.generatePromptTab.onMessage(message);
        if (handled) {
          return;
        }
      }

      // Let the selectFilesTab handle its relevant commands
      if (window.selectFilesTab && typeof window.selectFilesTab.onMessage === 'function') {
        const handled = window.selectFilesTab.onMessage(message);
        if (handled) {
          return;
        }
      }

      switch (message.command) {
          case 'updateIgnoreConfig':
              // Handling as fallback only if selectFilesTab did not handle it
              if (respectGitignore && ignorePatterns) {
                  ignorePatterns.value = message.ignorePatterns;
                  if (message.respectGitignore) {
                      respectGitignore.classList.add('checked');
                  } else {
                      respectGitignore.classList.remove('checked');
                  }
                  
                  // Always hide the save button since it's not needed
                  if (saveIgnoreBtn) {
                      saveIgnoreBtn.style.display = 'none';
                  }
                  
                  // Always use the same info message
                  const infoMessage = document.querySelector('.info-message');
                  if (infoMessage) {
                      infoMessage.innerHTML = 'Default ignore patterns are used unless a <code>.promptcode_ignore</code> file exists in your workspace root.';
                  }
              }
              break;

          case 'updateSelectedFiles':
              // Log the message for debugging
              console.log(`Received updateSelectedFiles: ${message.selectedFiles ? message.selectedFiles.length : 0} files`);
              
              // Let the selectFilesTab handle the UI update
              if (window.selectFilesTab && typeof window.selectFilesTab.onMessage === 'function') {
                window.selectFilesTab.onMessage(message);
              } else {
                console.warn('selectFilesTab not available or onMessage not implemented. Will save data for later.');
                // Store the data for when the tab becomes available
                window._pendingSelectedFiles = message;
              }
              
              // Also notify the generatePromptTab if it wants to re-generate
              console.log('Checking if generatePromptTab is available to notify about file selection changes');
              if (window.generatePromptTab && typeof window.generatePromptTab.onSelectedFilesChanged === 'function') {
                console.log('Calling generatePromptTab.onSelectedFilesChanged()');
                window.generatePromptTab.onSelectedFilesChanged();
              } else {
                console.warn('generatePromptTab not available or onSelectedFilesChanged not implemented');
              }
              break;

          case 'updateMergeContent':
              // Pass message to the merge tab
              if (window.mergeTab && typeof window.mergeTab.onMessage === 'function') {
                window.mergeTab.onMessage(message);
              }
              break;

          case 'codeReplaced':
              // Pass message to the merge tab
              if (window.mergeTab && typeof window.mergeTab.onMessage === 'function') {
                window.mergeTab.onMessage(message);
              }
              break;

          default:
              // no-op
              break;
      }
  });

  // Handle view mode buttons
  document.getElementById('folder-view-btn')?.addEventListener('click', () => {
      setViewMode('folder');
  });

  document.getElementById('file-view-btn')?.addEventListener('click', () => {
      setViewMode('file');
  });

  function setViewMode(mode) {
      viewMode = mode;
      document.getElementById('folder-view-btn').classList.toggle('active', mode === 'folder');
      document.getElementById('file-view-btn').classList.toggle('active', mode === 'file');
      vscode.postMessage({ command: 'getSelectedFiles' });
  }

  // Context Menu Handling
  const contextMenu = document.getElementById('context-menu');
  let activeFilePath = '';

  window.handleFileContextMenu = function(event, filePath) {
      event.preventDefault();
      event.stopPropagation();
      activeFilePath = filePath;
      if (contextMenu) {
          contextMenu.style.top = `${event.clientY}px`;
          contextMenu.style.left = `${event.clientX}px`;
          const rect = contextMenu.getBoundingClientRect();
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          if (rect.right > viewportWidth) {
              contextMenu.style.left = `${viewportWidth - rect.width - 5}px`;
          }
          if (rect.bottom > viewportHeight) {
              contextMenu.style.top = `${viewportHeight - rect.height - 5}px`;
          }
          contextMenu.style.display = 'block';
          contextMenu.classList.add('visible');
      }
      return false;
  };

  document.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
          const action = e.currentTarget.getAttribute('data-action');
          if (action === 'copyPath') {
              console.log('Copying absolute path:', activeFilePath);
              vscode.postMessage({
                  command: 'copyPath',
                  filePath: activeFilePath
              });
          } else if (action === 'copyRelativePath') {
              console.log('Copying relative path:', activeFilePath);
              vscode.postMessage({
                  command: 'copyRelativePath',
                  filePath: activeFilePath
              });
          } else if (action === 'openInEditor') {
              console.log('Opening file in editor:', activeFilePath);
              vscode.postMessage({
                  command: 'openFile',
                  filePath: activeFilePath
              });
          } else if (action === 'removeFile') {
              vscode.postMessage({
                  command: 'deselectFile',
                  filePath: activeFilePath
              });
          }
          if (contextMenu) {
              contextMenu.classList.remove('visible');
          }
      });
  });

  document.addEventListener('click', () => {
      if (contextMenu) {
          contextMenu.classList.remove('visible');
      }
  });

  document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && contextMenu) {
          contextMenu.classList.remove('visible');
      }
  });

  // Tab switching
  const tabs = document.querySelectorAll('.tabs-list .tab-trigger');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
          const tabId = tab.getAttribute('data-tab');
          console.log('[Tab Switch Debug] Tab changed:', { fromTab: document.querySelector('.tab-trigger.active')?.getAttribute('data-tab'), toTab: tabId });

          // Deactivate others
          tabs.forEach(t => t.classList.remove('active'));
          tabContents.forEach(c => c.classList.remove('active'));

          // Activate this
          tab.classList.add('active');
          const contentEl = document.getElementById(`${tabId}-tab`);
          if (contentEl) {
            contentEl.classList.add('active');
          }

          // Let the extension side know
          vscode.postMessage({ command: 'tabChanged', tabId });

          // Special actions for each tab
          if (tabId === 'instructions') {
              console.log('[Tab Switch Debug] Loading instructions due to tab switch');
              vscode.postMessage({ command: 'loadInstructions' });
              
              // Pre-fetch prompts when switching to instructions tab
              console.log('[Tab Switch Debug] Pre-fetching prompts for @ completion');
              const includeBuiltIn = document.querySelector('#include-built-in-templates')?.classList.contains('checked') ?? true;
              const folders = document.querySelector('#prompt-folders')?.value ?? '';
              vscode.postMessage({ 
                command: 'requestPrompts',
                includeBuiltInTemplates: includeBuiltIn,
                promptFolders: folders
              });
          } else if (tabId === 'prompt') {
              console.log('[Tab Switch Debug] Activating prompt tab');
              // Let the generatePromptTab know we just switched to tab #3
              if (window.generatePromptTab && typeof window.generatePromptTab.onTabActivated === 'function') {
                window.generatePromptTab.onTabActivated();
              }
          } else if (tabId === 'merge') {
              console.log('[Tab Switch Debug] Activating merge tab');
              // Let the extension know we switched to the merge tab
              vscode.postMessage({ command: 'mergeTabActivated' });
          }
      });
  });

  // On DOMContentLoaded, you could optionally auto-switch tab
  document.addEventListener('DOMContentLoaded', () => {
      // e.g. auto-switch to instructions if you want
      // const instructionsTab = document.querySelector('.tab-trigger[data-tab="instructions"]');
      // if (instructionsTab) instructionsTab.click();
      
      // Add footer link handlers
      const docLink = document.getElementById('documentation-link');
      const issueLink = document.getElementById('report-issue-link');
      
      if (docLink) {
          docLink.addEventListener('click', (e) => {
              e.preventDefault();
              vscode.postMessage({ 
                  command: 'openExternal',
                  url: 'https://github.com/cogflows/promptcode-vscode#readme'
              });
          });
      }
      
      if (issueLink) {
          issueLink.addEventListener('click', (e) => {
              e.preventDefault();
              vscode.postMessage({ 
                  command: 'openExternal',
                  url: 'https://github.com/cogflows/promptcode-vscode/issues/new'
              });
          });
      }
  });
})();