/** 
 * This function returns the HTML snippet for the "Generate Prompt" tab content.
 * You can tweak or reorganize the markup here if desired.
 */
export function getPromptTabHtml(): string {
  return /* html */ `
    <div class="card">
      <div class="instruction-header">
        <h3 class="instruction-title">Generate Prompt</h3>
        <p class="instruction-subtitle">Review and use your generated prompt</p>
      </div>
      <div class="card-content">
        <div class="include-options">
          <label class="checkbox-container">
            <div class="custom-checkbox checked" id="include-files">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <span>Files</span>
          </label>
          <label class="checkbox-container">
            <div class="custom-checkbox checked" id="include-instructions">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <span>Instructions</span>
          </label>
        </div>
        <div class="prompt-stats">
          <div class="token-count-display">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
            <span>Token Count: <strong id="prompt-token-count">0</strong></span>
          </div>
          <div id="generate-spinner" class="generate-spinner hidden">
            <span class="codicon codicon-loading codicon-modifier-spin"></span>
            <span>Generating...</span>
          </div>
        </div>
        <div class="prompt-actions">
          <button class="button primary" id="copy-prompt-btn" title="Copy to Clipboard">
            <span class="codicon codicon-copy"></span>
            Copy to Clipboard
          </button>
          <button class="button primary" id="open-prompt-btn" title="Open in Editor">
            <span class="codicon codicon-go-to-file"></span>
            Open in Editor
          </button>
          <button class="button primary" id="save-prompt-btn" title="Save to file">
            <span class="codicon codicon-save"></span>Save to file
          </button>
        </div>
      </div>
    </div>
  `;
} 