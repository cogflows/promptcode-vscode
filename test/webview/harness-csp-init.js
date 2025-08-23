/**
 * Initialization script for test data
 * Uses event listeners instead of inline handlers (CSP-compliant)
 */

// Initialize webview after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTestHarness);
} else {
    initializeTestHarness();
}

function initializeTestHarness() {
    // Trigger any initialization that the webview expects
    if (typeof initializeWebview === 'function') {
        initializeWebview();
    }
    
    // Set up test data for the Select Files tab
    const testFiles = [
        {
            directory: 'test/',
            files: [
                { name: 'file1.ts', path: '/test/file1.ts', tokens: 1500, percentage: 60 },
                { name: 'file2.ts', path: '/test/file2.ts', tokens: 800, percentage: 32 }
            ]
        },
        {
            directory: 'src/',
            files: [
                { name: 'main.ts', path: '/src/main.ts', tokens: 200, percentage: 8 }
            ]
        }
    ];
    
    // Populate the selected files list with test data
    const filesList = document.getElementById('selected-files-list');
    if (filesList) {
        testFiles.forEach(group => {
            // Add directory header
            const header = document.createElement('div');
            header.className = 'directory-header';
            
            const dirName = document.createElement('span');
            dirName.className = 'directory-name';
            dirName.textContent = group.directory;
            
            const trashBtn = document.createElement('button');
            trashBtn.className = 'trash-btn';
            trashBtn.title = 'Remove directory';
            trashBtn.textContent = '🗑️';
            trashBtn.setAttribute('data-directory', group.directory);
            
            header.appendChild(dirName);
            header.appendChild(trashBtn);
            filesList.appendChild(header);
            
            // Add files
            group.files.forEach(file => {
                const fileItem = document.createElement('div');
                fileItem.className = 'selected-file-item';
                
                const fileName = document.createElement('span');
                fileName.className = 'file-name';
                fileName.textContent = file.name;
                
                const tokenCount = document.createElement('span');
                tokenCount.className = 'token-count';
                tokenCount.textContent = `${(file.tokens/1000).toFixed(2)}k tokens (${file.percentage.toFixed(1)}%)`;
                
                fileItem.appendChild(fileName);
                fileItem.appendChild(tokenCount);
                filesList.appendChild(fileItem);
            });
        });
        
        // Add event listener for trash buttons (CSP-compliant)
        filesList.addEventListener('click', (e) => {
            const trashBtn = e.target.closest('.trash-btn');
            if (trashBtn) {
                const header = trashBtn.closest('.directory-header');
                if (header) {
                    // Remove the header and its files
                    let next = header.nextElementSibling;
                    while (next && !next.classList.contains('directory-header')) {
                        const toRemove = next;
                        next = next.nextElementSibling;
                        toRemove.remove();
                    }
                    header.remove();
                }
            }
        });
    }
    
    // Add test file tree for interaction testing
    const fileTreeContainer = document.getElementById('file-tree-container');
    if (fileTreeContainer) {
        const tree = document.createElement('div');
        tree.className = 'file-tree';
        
        // Create folder item
        const folderItem = document.createElement('div');
        folderItem.className = 'tree-item folder';
        folderItem.setAttribute('data-path', '/src');
        
        const folderIcon = document.createElement('span');
        folderIcon.className = 'tree-icon';
        folderIcon.textContent = '📁';
        
        const folderCheckbox = document.createElement('input');
        folderCheckbox.type = 'checkbox';
        folderCheckbox.className = 'file-checkbox';
        folderCheckbox.setAttribute('data-path', '/src');
        
        const folderLabel = document.createElement('span');
        folderLabel.className = 'tree-label';
        folderLabel.textContent = 'src';
        
        folderItem.appendChild(folderIcon);
        folderItem.appendChild(folderCheckbox);
        folderItem.appendChild(folderLabel);
        
        // Create file item
        const fileItem = document.createElement('div');
        fileItem.className = 'tree-item file';
        fileItem.setAttribute('data-path', '/src/index.ts');
        
        const fileIcon = document.createElement('span');
        fileIcon.className = 'tree-icon';
        fileIcon.textContent = '📄';
        
        const fileCheckbox = document.createElement('input');
        fileCheckbox.type = 'checkbox';
        fileCheckbox.className = 'file-checkbox';
        fileCheckbox.setAttribute('data-path', '/src/index.ts');
        
        const fileLabel = document.createElement('span');
        fileLabel.className = 'tree-label';
        fileLabel.textContent = 'index.ts';
        
        fileItem.appendChild(fileIcon);
        fileItem.appendChild(fileCheckbox);
        fileItem.appendChild(fileLabel);
        
        tree.appendChild(folderItem);
        tree.appendChild(fileItem);
        fileTreeContainer.appendChild(tree);
        
        // Add checkbox interaction handlers (CSP-compliant)
        tree.addEventListener('change', (e) => {
            if (e.target.classList.contains('file-checkbox')) {
                const path = e.target.getAttribute('data-path');
                const checked = e.target.checked;
                console.log(`Checkbox ${checked ? 'checked' : 'unchecked'}: ${path}`);
                
                // Simulate VS Code message
                if (window.vscode) {
                    window.vscode.postMessage({
                        command: checked ? 'selectFile' : 'deselectFile',
                        path: path
                    });
                }
            }
        });
        
        // Add folder expand/collapse (CSP-compliant)
        tree.addEventListener('click', (e) => {
            const folderItem = e.target.closest('.tree-item.folder');
            if (folderItem && !e.target.classList.contains('file-checkbox')) {
                folderItem.classList.toggle('expanded');
                console.log(`Folder toggled: ${folderItem.getAttribute('data-path')}`);
            }
        });
        
        // Add select all/deselect all functionality
        const selectAllBtn = document.getElementById('selectAllBtn');
        const deselectAllBtn = document.getElementById('deselectAllBtn');
        
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                document.querySelectorAll('.file-checkbox').forEach(cb => {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                });
            });
        }
        
        if (deselectAllBtn) {
            deselectAllBtn.addEventListener('click', () => {
                document.querySelectorAll('.file-checkbox').forEach(cb => {
                    cb.checked = false;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                });
            });
        }
    }
}

// Export test helpers
window.testHelpers = {
    // Simulate file selection
    selectFile: (path) => {
        const checkbox = document.querySelector(`.file-checkbox[data-path="${path}"]`);
        if (checkbox) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
    },
    
    // Simulate folder expansion
    expandFolder: (path) => {
        const folder = document.querySelector(`.tree-item.folder[data-path="${path}"]`);
        if (folder && !folder.classList.contains('expanded')) {
            folder.click();
        }
    },
    
    // Get CSP violations
    getCSPViolations: () => window.__CSP_VIOLATIONS__ || [],
    
    // Clear violations
    clearCSPViolations: () => {
        window.__CSP_VIOLATIONS__ = [];
    }
};