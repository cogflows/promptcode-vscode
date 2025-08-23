/**
 * Simple test data initialization
 */

document.addEventListener('DOMContentLoaded', () => {
    // Add test file tree elements
    const fileTree = document.getElementById('file-tree-container');
    if (fileTree) {
        // Create test checkboxes
        const checkbox1 = document.createElement('input');
        checkbox1.type = 'checkbox';
        checkbox1.className = 'file-checkbox';
        checkbox1.setAttribute('data-path', '/src/index.ts');
        
        const checkbox2 = document.createElement('input');
        checkbox2.type = 'checkbox';
        checkbox2.className = 'file-checkbox';
        checkbox2.setAttribute('data-path', '/src/utils.ts');
        
        const folder = document.createElement('div');
        folder.className = 'tree-item folder';
        folder.setAttribute('data-path', '/src');
        folder.textContent = 'src';
        
        fileTree.appendChild(folder);
        fileTree.appendChild(checkbox1);
        fileTree.appendChild(checkbox2);
        
        // Add event listeners (CSP-compliant)
        fileTree.addEventListener('click', (e) => {
            if (e.target.classList.contains('folder')) {
                e.target.classList.toggle('expanded');
            }
        });
    }
    
    // Add test directory headers
    const filesList = document.getElementById('selected-files-list');
    if (filesList) {
        const header = document.createElement('div');
        header.className = 'directory-header';
        header.textContent = 'test/';
        
        const trashBtn = document.createElement('button');
        trashBtn.className = 'trash-btn';
        trashBtn.textContent = '🗑️';
        header.appendChild(trashBtn);
        
        filesList.appendChild(header);
    }
    
    // Wire up buttons
    const selectAll = document.getElementById('selectAllBtn');
    const deselectAll = document.getElementById('deselectAllBtn');
    
    if (selectAll) {
        selectAll.addEventListener('click', () => {
            document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = true);
        });
    }
    
    if (deselectAll) {
        deselectAll.addEventListener('click', () => {
            document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = false);
        });
    }
});