import { SAVE_PROMPT_TO_FILE } from '../constants'; // Import the constant

let latestPreview = ''; // <-- holds the rendered prompt text

(function () {
  /**
   * This namespace (or module pattern) holds all the logic for the "Generate Prompt" tab.
   */
  function initGeneratePromptTab(vscode) {
    // Grab references to the elements we care about in the "Generate Prompt" tab
    const copyButton = document.getElementById('copy-prompt-btn');
    const openButton = document.getElementById('open-prompt-btn');
    const spinner = document.getElementById('generate-spinner');
    const tokenCountDisplay = document.querySelector('#prompt-tab .prompt-stats .token-count-display');
    const tokenCountElement = document.getElementById('prompt-token-count');
    const actionsContainer = openButton.parentElement; // Assuming buttons share the same parent

    // --- Save to file feature ---
    // const saveBtn = document.createElement('button');
    // saveBtn.id = 'saveToFileBtn';
    // saveBtn.className = 'btn btn-primary'; // matches the existing style util
    // saveBtn.textContent = 'Save to file';
    // if (actionsContainer && openButton) {
    //     actionsContainer.insertBefore(saveBtn, openButton.nextSibling); // Insert after openButton
    // } else if (actionsContainer) {
    //     actionsContainer.appendChild(saveBtn); // Fallback if openButton isn't found
    // }
    // --- End Save to file feature ---

    // Track the time when generating mode starts and pending data
    let generatingStartTime = 0;
    let pendingPreparedData = null;
    let preparedModeTimeout = null;

    // Checkboxes for "Files", "Instructions", "Prompts"
    const includeFilesCheckbox = document.getElementById('include-files');
    const includeInstructionsCheckbox = document.getElementById('include-instructions');

    // Attach click events to "Copy" and "Open" buttons
    if (copyButton) {
      copyButton.addEventListener('click', () => {
        // We trigger the "copyPromptDirectly" command
        console.log('CopyPrompt command triggered from GeneratePromptTab');
        vscode.postMessage({ command: 'copyPrompt' });
      });
    }
    if (openButton) {
      openButton.addEventListener('click', () => {
        // We trigger the "openPrompt" command
        console.log('OpenPrompt command triggered from GeneratePromptTab');
        vscode.postMessage({ command: 'openPrompt' });
      });
    }

    // --- Save to file feature ---
    // if (saveBtn) {
    //   saveBtn.addEventListener('click', () => {
    //     // We need to get the prompt text. Let's assume it's held by the extension
    //     // and we need to request it, or find where it's stored in the DOM if it is.
    //     // For now, let's request it as part of the save command.
    //     // If there's a text area, use that:
    //     const promptTextArea = document.getElementById('promptTextArea'); // Get the text area
    //     const promptText = promptTextArea ? promptTextArea.value : ''; // Get its value

    //     // Let's post a message and let the extension handle getting the text and saving.
    //     console.log('SaveToFile command triggered from GeneratePromptTab');
    //     // We'll add the promptText retrieval later if needed, assuming the host has it
    //     vscode.postMessage({
    //       command: SAVE_PROMPT_TO_FILE, // Use the constant
    //       promptText: promptText // Include the text from the text area
    //     });
    //   });
    // }
    // --- End Save to file feature ---
    const saveButton = document.getElementById('save-prompt-btn');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        // Add check for latestPreview
        if (!latestPreview) {
          console.warn('Save clicked before preview available');
          // Optionally show a user-facing message here
          return; 
        }
        vscode.postMessage({ 
          command: SAVE_PROMPT_TO_FILE,
          promptText: latestPreview // NEW - send the captured preview
        });
      });
    }

    // Toggling checkboxes
    [includeFilesCheckbox, includeInstructionsCheckbox].forEach((checkbox) => {
      if (!checkbox) {return;}
      checkbox.addEventListener('click', () => {
        checkbox.classList.toggle('checked');
        // Re-generate the preview, if we are on this tab
        maybeRegeneratePrompt();
      });
    });

    /**
     * Called whenever we switch to the #prompt-tab (Tab #3). 
     * We display the spinner and request a fresh preview from the extension.
     */
    function onTabActivated() {
      showGeneratingMode();
      requestPromptPreview(null); // no special "action"
    }

    /**
     * Called whenever the user changed the selected files (or instructions)
     * and we want to see if we should re-generate the prompt.
     */
    function onSelectedFilesChanged() {
      console.log('onSelectedFilesChanged called in generatePromptTab');
      const isActiveTab = isActive();
      console.log('isActive() returned:', isActiveTab);
      
      if (isActiveTab) {
        // If we're indeed on the prompt tab, re-generate the preview.
        maybeRegeneratePrompt();
      }
    }

    /**
     * Figures out if #prompt-tab is the currently active tab in the UI.
     */
    function isActive() {
      // Check both the tab trigger AND the tab content element
      const promptTabTrigger = document.querySelector('.tab-trigger[data-tab="prompt"]');
      const promptTabContent = document.getElementById('prompt-tab');
      
      // Log the state for debugging
      console.log('Tab State Check:', {
        triggerExists: !!promptTabTrigger,
        triggerActive: promptTabTrigger ? promptTabTrigger.classList.contains('active') : false,
        contentExists: !!promptTabContent,
        contentActive: promptTabContent ? promptTabContent.classList.contains('active') : false
      });
      
      // The tab is considered active if both the trigger has active class AND the content element has active class
      return (promptTabTrigger && promptTabTrigger.classList.contains('active')) &&
             (promptTabContent && promptTabContent.classList.contains('active'));
    }

    /**
     * If we're on the prompt tab, request a new preview from the extension.
     */
    function maybeRegeneratePrompt() {
      if (isActive()) {
        // Clear any pending timeout if we're generating again
        if (preparedModeTimeout) {
          clearTimeout(preparedModeTimeout);
          preparedModeTimeout = null;
          pendingPreparedData = null;
        }
        
        showGeneratingMode();
        requestPromptPreview(null);
      }
    }

    /**
     * Actually send the `generatePromptPreview` message to the extension 
     * with the "include" checkboxes state. 
     */
    function requestPromptPreview(action) {
      const includeOptions = {
        files: includeFilesCheckbox?.classList.contains('checked'),
        instructions: includeInstructionsCheckbox?.classList.contains('checked')
      };
      vscode.postMessage({
        command: 'generatePromptPreview',
        includeOptions,
        action,
        source: 'generatePromptTab'
      });
    }

    /**
     * When we haven't yet gotten the prompt preview back, show the spinner
     * and hide the token count / disable the buttons.
     */
    function showGeneratingMode() {
      // Record the time when we started generating
      generatingStartTime = Date.now();
      
      if (spinner) {spinner.classList.remove('hidden');}
      if (tokenCountDisplay) {tokenCountDisplay.classList.add('hidden');}
      if (copyButton) {copyButton.disabled = true;}
      if (openButton) {openButton.disabled = true;}
      if (saveButton) {saveButton.disabled = true;}
    }

    /**
     * When we do have the prompt data, hide the spinner, show the token count,
     * re-enable the buttons - but only if at least 3 seconds have passed since 
     * we started generating.
     */
    function showPreparedMode(tokenCount) {
      const MIN_GENERATING_TIME = 500; // 3 seconds minimum display time
      const elapsedTime = Date.now() - generatingStartTime;
      
      // Save the data for when we display it
      pendingPreparedData = { tokenCount };
      
      // If less than 3 seconds have passed, set a timeout to display later
      if (elapsedTime < MIN_GENERATING_TIME) {
        const remainingTime = MIN_GENERATING_TIME - elapsedTime;
        
        // Clear any existing timeout
        if (preparedModeTimeout) {
          clearTimeout(preparedModeTimeout);
        }
        
        // Set timeout to display after the remaining time
        preparedModeTimeout = setTimeout(() => {
          applyPreparedMode();
          preparedModeTimeout = null;
        }, remainingTime);
        
        return;
      }
      
      // If 3+ seconds have passed, display immediately
      applyPreparedMode();
    }
    
    /**
     * Actually applies the prepared mode once timing requirements are met
     */
    function applyPreparedMode() {
      if (!pendingPreparedData) {return;}
      
      if (spinner) {spinner.classList.add('hidden');}
      if (tokenCountDisplay) {tokenCountDisplay.classList.remove('hidden');}
      if (copyButton) {copyButton.disabled = false;}
      if (openButton) {openButton.disabled = false;}
      if (saveButton) {saveButton.disabled = false;}

      if (typeof pendingPreparedData.tokenCount === 'number' && tokenCountElement) {
        tokenCountElement.textContent = formatTokenCount(pendingPreparedData.tokenCount);
      }
      
      // Clear the pending data after applying
      pendingPreparedData = null;
    }

    /**
     * Helper to convert token counts to a "k" format (e.g. 12000 => "12.00k")
     */
    function formatTokenCount(count) {
      return (count / 1000).toFixed(2) + 'k';
    }

    /**
     * Called from the global window.onmessage listener. We check if 
     * the message is "updatePromptPreview" for this tab. If so, we handle it here.
     * Return true if we handled it, false otherwise.
     */
    function onMessage(message) {
      switch (message.command) {
        case 'promptPreviewGenerated':
          // This is the extension telling us the final prompt text and token count
          // for tab #3
          // Show the final mode (and optionally copy if there's an action)
          const { preview, tokenCount, action } = message;
          latestPreview = preview; // NEW - store the latest preview

          // Store the latest preview text perhaps? How is it accessed by Open/Copy?
          // Let's assume for now the host holds the latest generated text.

          showPreparedMode(tokenCount);

          // If the extension side wants to do something special after generation:
          if (action === 'copyToClipboard') {
            // fallback – copy here if needed
            fallbackCopyToClipboard(preview);
          } else if (action === 'openInEditor') {
            // fallback – open in editor if needed
            vscode.postMessage({ command: 'openPrompt' });
          }
          return true;

        default:
          return false;
      }
    }

    /**
     * Attempt to copy text to the clipboard in the browser environment 
     * (as a fallback). Normally the extension does it, but this is a fallback.
     */
    function fallbackCopyToClipboard(text) {
      if (!navigator?.clipboard) {return;}
      navigator.clipboard.writeText(text).then(() => {
        console.log('Copied to clipboard (fallback in browser).');
      }).catch(() => {
        console.warn('Fallback copy failed. Relying on extension side copy.');
        vscode.postMessage({ command: 'copyPrompt' });
      });
    }

    // Return public-ish methods that webview.js can call 
    window.generatePromptTab = {
      onTabActivated,
      onSelectedFilesChanged,
      onMessage
    };
  }

  // Expose the initializer
  window.initGeneratePromptTab = initGeneratePromptTab;
})(); 