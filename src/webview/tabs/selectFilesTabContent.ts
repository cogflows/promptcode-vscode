/** 
 * This function returns the HTML snippet for the "Select Files" tab content.
 * You can tweak or reorganize the markup here if desired.
 */
export function getSelectFilesTabHtml(): string {
  return /* html */ `
    <!-- Configuration Section -->
    <section class="configuration-section collapsed" id="config-section">
      <div class="section-header" id="config-section-header">
        <div class="section-title">Configuration</div>
        <span class="codicon codicon-chevron-right toggle-icon"></span>
      </div>
      <div class="configuration-content" id="config-content">
        <div class="checkbox-container">
          <div class="custom-checkbox" id="respect-gitignore">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <label>Respect .gitignore rules</label>
        </div>
        <div class="ignore-patterns-container">
          <label for="ignore-patterns" class="text-sm text-muted">Ignore patterns</label>
          <textarea id="ignore-patterns" class="ignore-textarea" placeholder="Add patterns to ignore (one per line)..."></textarea>
        </div>
        <button id="save-ignore-btn" class="button">
          <span class="codicon codicon-save"></span>
          Save .promptcode_ignore
        </button>
      </div>
    </section>

    <!-- ADDED: Presets Section -->
    <section class="presets-section">
      <div class="section-title">File Selection Presets</div>
      <div class="presets-actions">
        <div class="preset-controls">
          <select id="file-preset-picker">
            <option value="none">No preset selected</option>
            <!-- Options added by JS -->
          </select>
          <button id="reapply-preset-btn" class="button" title="Re-apply the selected preset" disabled>
            <span class="codicon codicon-refresh"></span>
            Re-apply
          </button>
          <button id="save-preset-btn" class="button" title="Save current selection as preset">
            <span class="codicon codicon-save"></span>
            Save
          </button>
        </div>
      </div>
    </section>
    <!-- END ADDED -->

    <!-- Actions Section -->
    <section class="actions-section">
      <div class="section-title">File Tree Actions</div>
      <div class="action-groups">
        <div class="search-container">
          <span class="codicon codicon-search search-icon"></span>
          <input type="text" id="file-search" placeholder="Search by name or glob (*, ?)..."></input>
          <span class="codicon codicon-close" id="clear-search"></span>
        </div>
        <div class="action-group">
          <button id="expand-all-btn" class="button">
            <span class="codicon codicon-expand-all"></span>
            Expand dirs
          </button>
          <button id="collapse-all-btn" class="button">
            <span class="codicon codicon-collapse-all"></span>
            Collapse dirs
          </button>
          <button id="select-all-btn" class="button">
            <span class="codicon codicon-check-all"></span>
            Select All
          </button>
          <button id="deselect-all-btn" class="button">
            <span class="codicon codicon-clear-all"></span>
            Clear All
          </button>
          <button id="load-file-list-btn" class="button" title="List of file paths or glob patterns (e.g., src/**/*.ts, /Users/me/file.txt), one per line.">
            <span class="codicon codicon-cloud-upload"></span>
            Add Files List
          </button>
        </div>
      </div>

      <div id="file-list-results" class="file-list-results" style="display: none; margin-top: var(--spacing-md);">
        <!-- Results will be displayed here -->
      </div>
    </section>

    <!-- ADDED: Modal for Adding File List -->
    <div id="add-list-modal-overlay" class="modal-overlay" style="display: none;">
      <div id="add-list-modal" class="modal-content">
        <h2>Add Files from List</h2>
        <p>Paste a list of file paths (one per line) or choose a file containing the list.</p>
        
        <div class="modal-option">
          <label for="paste-file-list-area">Paste List:</label>
          <textarea id="paste-file-list-area" rows="6" placeholder="e.g.,
src/app.ts
src/utils/helper.js
**/test/*.test.ts"></textarea>
          <button id="add-pasted-list-btn" class="button">Add Pasted Files</button>
        </div>

        <div class="modal-divider">OR</div>

        <div class="modal-option">
          <button id="choose-file-list-btn" class="button">
            <span class="codicon codicon-folder-opened"></span> Load List from File...
          </button>
        </div>

        <div class="modal-actions">
          <button id="cancel-add-list-modal-btn" class="button secondary">Cancel</button>
        </div>
      </div>
    </div>
    <!-- END ADDED -->

    <!-- Selected Files Container -->
    <section class="selected-files-container">
      <div class="section-title">Selected Files</div>
      <div class="files-header">
        <div class="total-stats">
          <span class="stat-label">Total Files:</span>
          <span class="stat-value" id="total-files">0</span>
          <span class="stat-spacer"></span>
          <span class="stat-label">Total Tokens:</span>
          <span class="stat-value" id="total-tokens">0k</span>
        </div>
        <div class="view-mode-buttons">
          <button id="refresh-view-btn" class="view-mode-button" title="Refresh File View">
            <span class="codicon codicon-refresh"></span>
          </button>
          <button id="folder-view-btn" class="view-mode-button active" title="Group by folder">
            <span class="codicon codicon-folder"></span>
          </button>
          <button id="file-view-btn" class="view-mode-button" title="View as list">
            <span class="codicon codicon-list-flat"></span>
          </button>
        </div>
      </div>
      <div id="selected-files-list" class="selected-files-list"></div>
    </section>
  `;
} 