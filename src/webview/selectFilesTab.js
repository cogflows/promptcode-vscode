/**
 * All the JavaScript for handling the "Select Files" tab:
 * - Searching files
 * - Expanding/collapsing
 * - Selecting/deselecting
 * - Respect .gitignore
 * - Etc.
 *
 * Called from webview.js via `window.initSelectFilesTab(vscode)`.
 */
console.log('Debug: Initializing selectFilesTab.js');

// Ensure we're in a browser environment
if (typeof window !== 'undefined') {
    try {
        console.log('Debug: Setting up selectFilesTab.js');
        
        // Define the initialization function
        window.initSelectFilesTab = function(vscode) {
            if (!vscode) {
                console.error('Debug: vscode API not provided to initSelectFilesTab');
                return;
            }

            try {
                // ----------------------------------------------------------
                // Helper Functions
                // ----------------------------------------------------------
                function escapeHtml(unsafe) {
                    if (!unsafe) {return '';}
                    return unsafe
                         .replace(/&/g, "&amp;")
                         .replace(/</g, "&lt;")
                         .replace(/>/g, "&gt;")
                         .replace(/"/g, "&quot;")
                         .replace(/'/g, "&#039;");
                }

                /**
                 * Sort files DESC by tokenCount, breaking ties alphabetically.
                 * Does NOT mutate the original array.
                 */
                function sortByTokenDesc(files) {
                    return [...files].sort((a, b) => {
                        const diff = (b.tokenCount ?? 0) - (a.tokenCount ?? 0);
                        return diff !== 0 ? diff : (a.path || '').localeCompare(b.path || '');
                    });
                }

                // ----------------------------------------------------------
                // Grab elements related to the "Select Files" tab
                // ----------------------------------------------------------
                const searchInput = document.getElementById('file-search');
                const clearSearchBtn = document.getElementById('clear-search');
                const configHeader = document.getElementById('config-section-header');
                const configContent = document.getElementById('config-content');
                const respectGitignore = document.getElementById('respect-gitignore');
                const ignorePatterns = document.getElementById('ignore-patterns');
                const saveIgnoreBtn = document.getElementById('save-ignore-btn');

                // Styles moved to selectfiles-fixes.css for CSP compliance

                // For expand/collapse/select/deselect
                const expandAllBtn = document.getElementById('expand-all-btn');
                const collapseAllBtn = document.getElementById('collapse-all-btn');
                const selectAllBtn = document.getElementById('select-all-btn');
                const deselectAllBtn = document.getElementById('deselect-all-btn');

                // For refreshing the view
                const refreshViewBtn = document.getElementById('refresh-view-btn');

                // Folder vs. file view mode
                const folderViewBtn = document.getElementById('folder-view-btn');
                const fileViewBtn = document.getElementById('file-view-btn');

                // --- ADDED: File List Elements ---
                const loadFileListBtn = document.getElementById('load-file-list-btn');
                const fileListResultsDiv = document.getElementById('file-list-results');
                // --- END ADDED ---

                // --- ADDED: Modal Elements ---
                const modalOverlay = document.getElementById('add-list-modal-overlay');
                const pasteTextArea = document.getElementById('paste-file-list-area');
                const addPastedListBtn = document.getElementById('add-pasted-list-btn');
                const chooseFileListBtn = document.getElementById('choose-file-list-btn');
                const cancelModalBtn = document.getElementById('cancel-add-list-modal-btn');
                // --- END ADDED ---

                // Track expanded directories and view mode
                let expandedDirectories = new Set();
                let viewMode = 'folder';  // Default to folder view
                
                // Process any pending selected files updates from previous view
                if (window._pendingSelectedFiles) {
                    console.log('Processing pending selected files update');
                    const pendingUpdate = window._pendingSelectedFiles;
                    window._pendingSelectedFiles = null;
                    setTimeout(() => {
                        onUpdateSelectedFiles(pendingUpdate);
                    }, 100);
                } else {
                    // Request a fresh update from extension
                    console.log('Requesting fresh selected files data');
                    vscode.postMessage({ command: 'getSelectedFiles' });
                }
                
                // Clear any inline transform styles that might interfere with our CSS
                document.querySelectorAll('.toggle-icon, .collapse-icon').forEach(icon => {
                    if (icon.style.transform) {
                        icon.style.transform = '';
                    }
                });

                // Log element availability for debugging
                console.log('Debug: Elements found:', {
                    searchInput: !!searchInput,
                    clearSearchBtn: !!clearSearchBtn,
                    configHeader: !!configHeader,
                    configContent: !!configContent,
                    respectGitignore: !!respectGitignore,
                    ignorePatterns: !!ignorePatterns,
                    saveIgnoreBtn: !!saveIgnoreBtn,
                    expandAllBtn: !!expandAllBtn,
                    collapseAllBtn: !!collapseAllBtn,
                    selectAllBtn: !!selectAllBtn,
                    deselectAllBtn: !!deselectAllBtn,
                    refreshViewBtn: !!refreshViewBtn,
                    folderViewBtn: !!folderViewBtn,
                    fileViewBtn: !!fileViewBtn
                });

                // Update the clear button visibility for searching
                function updateClearButtonVisibility() {
                    if (!searchInput) {return;}
                    if (searchInput.value) {
                        clearSearchBtn.style.display = 'block';
                    } else {
                        clearSearchBtn.style.display = 'none';
                    }
                }

                // Format token count to k format
                function formatTokenCount(count) {
                    return (count / 1000).toFixed(2) + 'k';
                }

                // Function to truncate long filenames
                function truncateFilename(filename, maxLength = 20) {
                    if (filename.length <= maxLength) {
                        return filename;
                    }
                    const start = filename.substring(0, maxLength / 2 - 2);
                    const end = filename.substring(filename.length - maxLength / 2 + 2);
                    return start + '...' + end;
                }

                // Render file items in a consistent way
                function renderFileItems(files, totalTokens) {
                    // Expect files to be pre-sorted by caller (largest tokens first)
                    return files.map(file => {
                        // More robust filename extraction
                        let fileName = '';
                        if (file.name) {
                            // If the file object directly provides a name property
                            fileName = file.name;
                        } else if (file.path) {
                            // Extract from path - handle both slash types
                            const pathParts = file.path.split(/[/\\]/);
                            fileName = pathParts[pathParts.length - 1] || file.path;
                        } else {
                            // Fallback
                            fileName = 'Unknown file';
                        }
                        
                        const truncatedName = truncateFilename(fileName);
                        const percentage = totalTokens === 0 ? '0.0' : ((file.tokenCount / totalTokens) * 100).toFixed(1);
                        const workspaceInfo = file.workspaceFolderName ? ` (${file.workspaceFolderName})` : '';
                        const fullTooltip = file.workspaceFolderName ? `${file.workspaceFolderName}: ${file.path}` : file.path;
                        
                        // Escape all user-controlled values to prevent XSS
                        const escPath = escapeHtml(file.path || '');
                        const escWsName = escapeHtml(file.workspaceFolderName || '');
                        const escRoot = escapeHtml(file.workspaceFolderRootPath || '');
                        const escTitle = escapeHtml(fullTooltip || '');
                        const escName = escapeHtml(truncatedName);
                        
                        // Use data attributes instead of inline onclick for security
                        return `
                            <div class="selected-file-item" data-path="${escPath}" data-workspace-folder="${escWsName}">
                                <div class="file-info">
                                    <div class="file-header">
                                        <div class="file-name-container">
                                            <span class="codicon codicon-file"></span>
                                            <span class="file-name" title="${escTitle}">${escName}</span>
                                        </div>
                                        <div class="file-actions">
                                            <a class="action-button js-file-action" data-action="open" data-path="${escPath}" data-root="${escRoot}" title="Open file">
                                                <span class="codicon codicon-open-preview"></span>
                                            </a>
                                            <a class="action-button js-file-action" data-action="remove" data-path="${escPath}" data-root="${escRoot}" title="Remove from selection">
                                                <span class="codicon codicon-trash"></span>
                                            </a>
                                        </div>
                                    </div>
                                    <span class="token-count">${formatTokenCount(file.tokenCount)} tokens (${percentage}%)</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                }

                // Directory toggle function
                window.toggleDirectoryFiles = function(header) {
                    const directorySection = header.closest('.directory-section');
                    const dirId = directorySection.getAttribute('data-dir-id');
                    const workspaceFolderName = directorySection.getAttribute('data-workspace-folder') || '';
                    const dirPath = window.directoryMap[dirId] || '';
                    
                    directorySection.classList.toggle('collapsed');
                    
                    if (directorySection.classList.contains('collapsed')) {
                        expandedDirectories.delete(`${workspaceFolderName}:${dirPath}`);
                    } else {
                        expandedDirectories.add(`${workspaceFolderName}:${dirPath}`);
                    }
                };

                // Add back the removeDirectory function
                window.removeDirectory = function(dirPath, workspaceFolderName) {
                    console.log('Removing directory:', dirPath, workspaceFolderName);
                    vscode.postMessage({
                        command: 'removeDirectory',
                        dirPath: dirPath,
                        workspaceFolderName: workspaceFolderName
                    });
                };

                // Handle selected files updates
                function onUpdateSelectedFiles(message) {
                    const selectedFilesList = document.getElementById('selected-files-list');
                    if (!selectedFilesList) {
                        console.log('Selected files list element not found');
                        return;
                    }

                    console.log(`Updating selected files UI: ${message.selectedFiles ? message.selectedFiles.length : 0} files`);

                    // Store current expanded directories to maintain state
                    const expandedDirs = new Set([...expandedDirectories]);

                    // Store current scroll position
                    const scrollTop = selectedFilesList.scrollTop || window.scrollY;

                    // Handle empty selection
                    if (!message.selectedFiles || message.selectedFiles.length === 0) {
                        selectedFilesList.innerHTML = '';
                        document.getElementById('total-files').textContent = '0';
                        document.getElementById('total-tokens').textContent = '0k';
                        return;
                    }

                    document.getElementById('total-files').textContent = message.selectedFiles.length.toString();
                    document.getElementById('total-tokens').textContent = formatTokenCount(message.totalTokens);

                    let html = '';
                    if (viewMode === 'folder') {
                        // Group all files by directory regardless of workspace
                        const filesByDirectory = message.selectedFiles.reduce((acc, file) => {
                            // Create a directory key that combines path and workspace
                            let dirPath = '.';
                            if (file.path) {
                                const pathParts = file.path.split(/[/\\]/);
                                // Remove the last element (filename) and join the rest
                                if (pathParts.length > 1) {
                                    pathParts.pop(); // Remove filename
                                    dirPath = pathParts.join('/');
                                }
                            }
                            
                            // Include workspace in key to properly separate multi-root directories
                            const dirKey = `${file.workspaceFolderName || ''}:${dirPath}`;
                            
                            if (!acc[dirKey]) {
                                acc[dirKey] = {
                                    dirPath,
                                    workspaceFolderName: file.workspaceFolderName || '',
                                    files: []
                                };
                            }
                            acc[dirKey].files.push(file);
                            return acc;
                        }, {});
                        
                        // Sort files within each directory by token count (descending)
                        Object.values(filesByDirectory).forEach(dir => {
                            dir.files = sortByTokenDesc(dir.files);
                        });
                        
                        const totalTokens = message.selectedFiles.reduce((sum, file) => sum + file.tokenCount, 0);
                        
                        // Sort directories by token count
                        const sortedDirectories = Object.values(filesByDirectory)
                            .map(dir => ({
                                ...dir,
                                totalTokens: dir.files.reduce((sum, file) => sum + file.tokenCount, 0)
                            }))
                            .sort((a, b) => b.totalTokens - a.totalTokens);
                        
                        // Render each directory with workspace info
                        html = sortedDirectories.map(({ dirPath, workspaceFolderName, files, totalTokens: dirTokens }) => {
                            const dirPercentage = totalTokens === 0 ? '0.0' : ((dirTokens / totalTokens) * 100).toFixed(1);
                            const isExpanded = expandedDirectories.has(`${workspaceFolderName}:${dirPath}`);
                            const workspaceLabel = workspaceFolderName ? ` (${workspaceFolderName})` : '';
                            
                            // Generate a unique ID for this directory
                            const id = (Math.random() + 1).toString(36).substring(2, 15) + (Math.random() + 1).toString(36).substring(2, 15);
                            window.directoryMap = window.directoryMap || {};
                            window.directoryMap[id] = dirPath === '.' ? '__ROOT__' : dirPath;

                            return `
                                <div class="directory-section ${isExpanded ? '' : 'collapsed'}" data-dir-id="${id}" data-workspace-folder="${workspaceFolderName}">
                                    <div class="directory-header">
                                        <div class="header-left">
                                            <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <polyline points="9 6 15 12 9 18"></polyline>
                                            </svg>
                                            <span class="directory-name">${dirPath}${workspaceLabel}</span>
                                        </div>
                                        <div class="header-right">
                                            <span class="directory-stats">${formatTokenCount(dirTokens)} tokens (${dirPercentage}%)</span>
                                            <button class="trash-btn action-button js-dir-remove"
                                                    data-dir="${escapeHtml(dirPath)}"
                                                    data-workspace="${escapeHtml(workspaceFolderName)}"
                                                    title="Remove all files in this directory">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M3 6h18"/>
                                                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="directory-files">
                                        ${renderFileItems(files, dirTokens)}
                                    </div>
                                </div>
                            `;
                        }).join('');
                    } else {
                        // File view mode (flat list)
                        const totalTokens = message.selectedFiles.reduce((sum, file) => sum + file.tokenCount, 0);
                        const sortedFiles = sortByTokenDesc(message.selectedFiles);
                        html = `
                            <div class="directory-files" style="margin-top: 0;">
                                ${renderFileItems(sortedFiles, totalTokens)}
                            </div>
                        `;
                    }

                    selectedFilesList.innerHTML = html;
                    
                    // Restore scroll position
                    setTimeout(() => {
                        if (typeof selectedFilesList.scrollTo === 'function') {
                            selectedFilesList.scrollTo(0, scrollTop);
                        } else {
                            window.scrollTo(0, scrollTop);
                        }
                    }, 10);
                    
                    // Restore expanded directories
                    expandedDirectories = expandedDirs;
                }

                // ----------------------------------------------------------
                // Search input handling
                // ----------------------------------------------------------
                let searchTimeout;
                
                function handleSearchInput(value) {
                    console.log('Sending search command with term:', value);
                    
                    // Set search term first
                    vscode.postMessage({
                        command: 'search',
                        searchTerm: value
                    });
                    
                    // Add or remove active-filter class
                    const searchContainer = document.querySelector('.search-container');
                    if (value.trim()) {
                        searchContainer?.classList.add('active-filter');
                        console.log('Search term entered');
                    } else {
                        searchContainer?.classList.remove('active-filter');
                        console.log('Search term cleared, restoring tree state');
                        // Don't collapse all - let the tree restore to its previous state
                    }
                }
                
                if (searchInput && clearSearchBtn) {
                    searchInput.addEventListener('input', function() {
                        // Debounce search
                        clearTimeout(searchTimeout);
                        searchTimeout = setTimeout(() => {
                            handleSearchInput(searchInput.value);
                            updateClearButtonVisibility();
                        }, 300);
                    });

                    clearSearchBtn.addEventListener('click', function() {
                        searchInput.value = '';
                        handleSearchInput('');
                        updateClearButtonVisibility();
                        searchInput.focus();
                    });

                    // Initialize search button and active filter display
                    updateClearButtonVisibility();
                    if (searchInput.value.trim()) {
                        document.querySelector('.search-container')?.classList.add('active-filter');
                    }
                }

                // ----------------------------------------------------------
                // Configuration toggle
                // ----------------------------------------------------------
                if (configHeader && configContent) {
                    configContent.style.display = 'none';
                    configHeader.addEventListener('click', function () {
                        const configSection = document.getElementById('config-section');
                        configSection.classList.toggle('collapsed');
                        if (configSection.classList.contains('collapsed')) {
                            configContent.style.display = 'none';
                        } else {
                            configContent.style.display = 'block';
                        }
                    });
                }

                // ----------------------------------------------------------
                // Respect .gitignore and Show ignore info
                // ----------------------------------------------------------
                if (respectGitignore && ignorePatterns && saveIgnoreBtn) {
                    // Get the parent container and label for better click handling
                    const checkboxContainer = respectGitignore.closest('.checkbox-container');
                    const checkboxLabel = checkboxContainer ? checkboxContainer.querySelector('label') : null;
                    
                    // Function to handle the checkbox toggle and save state
                    const updateCheckboxState = function(shouldBeChecked) {
                        console.log('Setting checkbox to', shouldBeChecked ? 'checked' : 'unchecked');
                        
                        // Set the visual state
                        if (shouldBeChecked) {
                            respectGitignore.classList.add('checked');
                        } else {
                            respectGitignore.classList.remove('checked');
                        }
                        
                        // Save to VS Code settings
                        console.log('Saving checkbox state:', shouldBeChecked);
                        vscode.postMessage({
                            command: 'saveIgnoreConfig',
                            respectGitignore: shouldBeChecked
                        });
                    };
                    
                    // Add click event directly to the checkbox with simple toggle
                    respectGitignore.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const newState = !respectGitignore.classList.contains('checked');
                        updateCheckboxState(newState);
                    });
                    
                    // Add click event to the label for better UX
                    if (checkboxLabel) {
                        checkboxLabel.addEventListener('click', function(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            const newState = !respectGitignore.classList.contains('checked');
                            updateCheckboxState(newState);
                        });
                    }

                    // Set ignorePatterns to read-only
                    ignorePatterns.setAttribute('readonly', 'readonly');
                    
                    // Add informative message if it doesn't exist yet
                    if (!document.querySelector('.info-message')) {
                        const infoMessage = document.createElement('div');
                        infoMessage.className = 'info-message';
                        infoMessage.innerHTML = 'Default ignore patterns are used unless a <code>.promptcode_ignore</code> file exists in your workspace root.';
                        ignorePatterns.parentNode.insertBefore(infoMessage, ignorePatterns);
                    }

                    // Hide the save button as it's not needed
                    saveIgnoreBtn.style.display = 'none';
                    
                    // Request current configuration
                    vscode.postMessage({ command: 'loadIgnoreConfig' });
                }

                // ----------------------------------------------------------
                // Expand/Collapse/Select/Deselect
                // ----------------------------------------------------------
                if (expandAllBtn) {
                    expandAllBtn.addEventListener('click', function() {
                        vscode.postMessage({ command: 'expandAll' });
                    });
                }

                if (collapseAllBtn) {
                    collapseAllBtn.addEventListener('click', function() {
                        vscode.postMessage({ command: 'collapseAll' });
                    });
                }

                if (selectAllBtn) {
                    selectAllBtn.addEventListener('click', function() {
                        vscode.postMessage({ command: 'selectAll' });
                    });
                }

                if (deselectAllBtn) {
                    deselectAllBtn.addEventListener('click', function() {
                        vscode.postMessage({ command: 'deselectAll' });
                    });
                }

                // ----------------------------------------------------------
                // Refresh view button handler
                // ----------------------------------------------------------
                if (refreshViewBtn) {
                    refreshViewBtn.addEventListener('click', function() {
                        console.log('Refreshing file view');
                        // Only refresh file explorer without clearing token cache
                        vscode.postMessage({ command: 'refreshFileExplorer' });
                    });
                }

                // ----------------------------------------------------------
                // Folder vs. File View
                // ----------------------------------------------------------
                function setViewMode(mode) {
                    viewMode = mode;
                    folderViewBtn.classList.toggle('active', mode === 'folder');
                    fileViewBtn.classList.toggle('active', mode === 'file');
                    vscode.postMessage({ command: 'getSelectedFiles' });
                }

                folderViewBtn?.addEventListener('click', () => {
                    setViewMode('folder');
                });

                fileViewBtn?.addEventListener('click', () => {
                    setViewMode('file');
                });

                // --- UPDATED: File List Button Listener to show modal ---
                if (loadFileListBtn && modalOverlay) {
                    loadFileListBtn.addEventListener('click', () => {
                        console.log('Load File List button clicked, showing modal.');
                        // Clear previous results display
                        if (fileListResultsDiv) {
                            fileListResultsDiv.innerHTML = '';
                            fileListResultsDiv.style.display = 'none';
                        }
                        // Show the modal
                        modalOverlay.style.display = 'flex';
                        if (pasteTextArea) {pasteTextArea.value = '';} // Clear textarea
                        if (pasteTextArea) {pasteTextArea.focus();}
                    });
                } else {
                    console.warn('Load File List button or modal overlay not found.');
                }
                // --- END UPDATED ---

                // --- ADDED: Modal Button Listeners ---
                if (modalOverlay && pasteTextArea && addPastedListBtn && chooseFileListBtn && cancelModalBtn) {
                    // Function to hide the modal
                    const hideModal = () => {
                        modalOverlay.style.display = 'none';
                        if (fileListResultsDiv) { // Ensure results div exists
                            fileListResultsDiv.innerHTML = '';
                            fileListResultsDiv.style.display = 'none';
                        }
                    };

                    // Add Pasted List Button
                    addPastedListBtn.addEventListener('click', () => {
                        const pastedContent = pasteTextArea.value.trim();
                        if (pastedContent) {
                            console.log('Processing pasted file list.');
                            vscode.postMessage({
                                command: 'processPastedFileList', // New command for pasted content
                                content: pastedContent
                            });
                            hideModal();
                        } else {
                            console.log('Paste area is empty.');
                            // Optionally show a small error/warning in the modal
                        }
                    });

                    // Choose File Button (inside modal)
                    chooseFileListBtn.addEventListener('click', () => {
                        console.log('Choose File button clicked inside modal.');
                        // Send the original command to trigger file dialog
                        vscode.postMessage({ command: 'loadFileRequest' });
                        hideModal(); // Hide modal after triggering file selection
                    });

                    // Cancel Button
                    cancelModalBtn.addEventListener('click', () => {
                        console.log('Modal cancelled.');
                        hideModal();
                    });

                    // Optional: Close modal if clicking outside the content area
                    modalOverlay.addEventListener('click', (event) => {
                        if (event.target === modalOverlay) {
                            hideModal();
                        }
                    });
                } else {
                    console.warn('One or more modal elements not found. Cannot attach listeners.');
                }
                // --- END ADDED ---

                // ----------------------------------------------------------
                // Message handling
                // ----------------------------------------------------------
                window.selectFilesTab = {
                    onMessage: function(message) {
                        switch (message.command) {
                            case 'updateSelectedFiles':
                                onUpdateSelectedFiles(message);
                                
                                // Also notify the generatePromptTab about file changes
                                if (window.generatePromptTab && typeof window.generatePromptTab.onSelectedFilesChanged === 'function') {
                                    console.log('Notifying generatePromptTab about file selection changes from selectFilesTab');
                                    window.generatePromptTab.onSelectedFilesChanged();
                                }
                                
                                return true;
                            case 'updateIgnoreConfig':
                                // Handle the ignore configuration response
                                if (respectGitignore && typeof message.respectGitignore === 'boolean') {
                                    console.log('Received updateIgnoreConfig in selectFilesTab with respectGitignore =', message.respectGitignore);
                                    
                                    const currentState = respectGitignore.classList.contains('checked');
                                    console.log('Current checkbox state before update:', currentState);
                                    
                                    if (message.respectGitignore) {
                                        respectGitignore.classList.add('checked');
                                    } else {
                                        respectGitignore.classList.remove('checked');
                                    }
                                    
                                    const newState = respectGitignore.classList.contains('checked');
                                    console.log('New checkbox state after update:', newState);
                                    
                                    if (ignorePatterns && message.ignorePatterns) {
                                        ignorePatterns.value = message.ignorePatterns;
                                    }
                                }
                                return true;
                            case 'updateUnmatchedPatterns':
                                console.log('Received updateUnmatchedPatterns:', message);
                                if (fileListResultsDiv) {
                                    let resultsHtml = '<p class="results-summary">';
                                    if (message.matchedCount !== undefined) {
                                        resultsHtml += `Added <strong>${message.matchedCount}</strong> file(s) to selection. `;
                                    }
                                    if (message.unmatchedPatterns && message.unmatchedPatterns.length > 0) {
                                        resultsHtml += `Could not match ${message.unmatchedPatterns.length} pattern(s):</p>`;
                                        resultsHtml += '<ul class="unmatched-list">';
                                        message.unmatchedPatterns.forEach(pattern => {
                                            resultsHtml += `<li><span class="codicon codicon-warning"></span> ${escapeHtml(pattern)}</li>`;
                                        });
                                        resultsHtml += '</ul>';
                                    } else {
                                        if (message.matchedCount !== undefined) {
                                            resultsHtml += 'All patterns matched.</p>';
                                        } else {
                                            resultsHtml = '<p class="results-summary">No new files matched or added.</p>';
                                        }
                                    }
                                    fileListResultsDiv.innerHTML = resultsHtml;
                                    fileListResultsDiv.style.display = 'block';
                                } else {
                                    console.warn('File list results div not found.');
                                }
                                return true;
                            case 'updateFilePresets':
                                console.log('[Frontend] Received updateFilePresets message with:', message.presets?.length || 0, 'presets');
                                if (window.selectFilesTab.handlePresetUpdate) {
                                    window.selectFilesTab.handlePresetUpdate(message.presets, message.selectPreset);
                                }
                                return true;
                            default:
                                return false;
                        }
                    }
                };

                /* ----------  Preset support  ---------- */
                const presetPicker = document.getElementById('file-preset-picker');
                const savePresetBtn = document.getElementById('save-preset-btn');
                const reapplyPresetBtn = document.getElementById('reapply-preset-btn');

                if (presetPicker && savePresetBtn && reapplyPresetBtn) {
                    // ask host for presets on load
                    vscode.postMessage({ command: 'requestFilePresets' });
                    
                    // Track current selected preset
                    let currentPresetName = null;

                    function populatePresetPicker(presets) {
                        if (!presets) {return;}
                        // Create the "No preset selected" option as the first option
                        let options = '<option value="none">No preset selected</option>';
                        // Add preset options
                        if (presets.length > 0) {
                            options += presets.map(p =>
                                `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
                        }
                        presetPicker.innerHTML = options;
                        
                        // Disable re-apply when no preset is selected
                        reapplyPresetBtn.disabled = true;
                    }

                    // Save button to trigger VSCode's native save dialog
                    savePresetBtn.addEventListener('click', () => {
                        try {
                            console.log('[Frontend] Save button clicked');
                            const selectedPreset = presetPicker.value;
                            
                            // Request the extension to show a save dialog
                            vscode.postMessage({ 
                                command: 'saveFilePreset', 
                                currentPreset: selectedPreset !== 'none' ? selectedPreset : null,
                                useSaveDialog: true
                            });
                        } catch (error) {
                            console.error('[Frontend] Error in save preset button:', error);
                        }
                    });
                    
                    // Re-apply button to explicitly re-apply current selection
                    reapplyPresetBtn.addEventListener('click', () => {
                        const name = presetPicker.value;
                        if (name && name !== 'none') {
                            console.log(`[Frontend] Re-applying preset: "${name}"`);
                            vscode.postMessage({ command: 'applyFilePreset', presetName: name });
                        }
                    });

                    // Auto-apply functionality on preset selection
                    presetPicker.addEventListener('change', () => {
                        const name = presetPicker.value;
                        
                        // Update re-apply button state
                        reapplyPresetBtn.disabled = !name || name === 'none';
                        
                        // Auto-apply on selection
                        if (name && name !== 'none') {
                            currentPresetName = name;
                            console.log(`[Frontend] Auto-applying preset: "${name}"`);
                            vscode.postMessage({ command: 'applyFilePreset', presetName: name });
                        } else if (name === 'none') {
                            currentPresetName = null;
                            console.log('[Frontend] "None" selected, clearing selection');
                            vscode.postMessage({ command: 'deselectAll' });
                        }
                    });

                    // Add safe event delegation for file actions (replaces inline onclick)
                    const selectedFilesListEl = document.getElementById('selected-files-list');
                    if (selectedFilesListEl) {
                        // Handle file open/remove actions
                        selectedFilesListEl.addEventListener('click', (e) => {
                            const el = e.target.closest('.js-file-action');
                            if (!el) {return;}

                            const action = el.getAttribute('data-action');
                            const path = el.getAttribute('data-path') || '';
                            const root = el.getAttribute('data-root') || '';

                            // Prevent bubbling
                            e.preventDefault();
                            e.stopPropagation();

                            if (action === 'open' && window.openFile) {
                                window.openFile(path, root);
                            } else if (action === 'remove' && window.deselectFile) {
                                window.deselectFile(path, root);
                            } else {
                                // Fallback to message passing
                                vscode.postMessage({ 
                                    command: action === 'open' ? 'openFile' : 'deselectFile', 
                                    path, 
                                    root 
                                });
                            }
                        });

                        // Handle directory remove actions
                        selectedFilesListEl.addEventListener('click', (e) => {
                            const btn = e.target.closest('.js-dir-remove');
                            if (!btn) {return;}
                            e.preventDefault();
                            e.stopPropagation();
                            const dir = btn.getAttribute('data-dir') || '';
                            const ws = btn.getAttribute('data-workspace') || '';
                            if (window.removeDirectory) {
                                window.removeDirectory(dir, ws);
                            } else {
                                vscode.postMessage({ 
                                    command: 'removeDirectory', 
                                    dirPath: dir, 
                                    workspaceFolderName: ws 
                                });
                            }
                        });
                    }

                    // Toggle a directory by clicking anywhere on its header (CSP-safe)
                    selectedFilesListEl.addEventListener('click', (e) => {
                        const header = e.target.closest('.directory-header');
                        if (!header || !selectedFilesListEl.contains(header)) {return;}
                        // Don't toggle if the click was on the remove button inside the header
                        if (e.target.closest('.js-dir-remove')) {return;}
                        e.preventDefault();
                        e.stopPropagation();
                        if (typeof window.toggleDirectoryFiles === 'function') {
                            window.toggleDirectoryFiles(header);
                        }
                    });

                    // Add listener for preset updates from host
                    // This listener needs to be accessible to the global message handler
                    window.selectFilesTab.handlePresetUpdate = function(presets, selectPreset) {
                        populatePresetPicker(presets);
                        
                        // If selectPreset is provided, select that preset in the dropdown
                        if (selectPreset) {
                            presetPicker.value = selectPreset;
                            
                            // Enable the re-apply button for the selected preset
                            reapplyPresetBtn.disabled = !selectPreset || selectPreset === 'none';
                            
                            // Don't auto-apply after save - the current selection IS what we just saved
                            // Auto-applying would overwrite any careful deselections with the broader pattern
                            if (selectPreset !== 'none') {
                                console.log(`[Frontend] Preset "${selectPreset}" saved - current selection preserved`);
                                currentPresetName = selectPreset;
                            }
                        }
                    };
                    
                    console.log('Preset UI elements initialized.');
                } else {
                    console.error('Preset UI elements not found! Missing:', {
                      presetPicker: !presetPicker,
                      savePresetBtn: !savePresetBtn,
                      reapplyPresetBtn: !reapplyPresetBtn
                    });
                }
                /* ---------- End Preset support ---------- */
            } catch (error) {
                console.error('Error in initSelectFilesTab:', error);
            }
        };
    } catch (error) {
        console.error('Error in selectFilesTab.js:', error);
    }
}