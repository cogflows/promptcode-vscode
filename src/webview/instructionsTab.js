(function () {
  /**
   * Initializes all logic for the "Add Instructions" tab, including:
   *  - The instructions text area
   *  - Automatic saving of instructions
   *  - Handling the "updateInstructions" message
   *  - Prompt picker for inserting embedded instructions
   *
   * @param {any} vscode - VS Code API object
   */
  function initInstructionsTab(vscode) {
    // We rely on any global that sets up: window.samplePrompts = [...];
    // If you prefer to pass them in, you can do: initInstructionsTab(vscode, prompts).
    // For now, we read window.samplePrompts directly:

    let availablePrompts = window.samplePrompts || [];
    // --- REMOVED: Global store for fetched content ---
    // window.fetchedPromptContents = {}; 

    // ------------------------------------------------
    // 0) Setup the configuration section
    // ------------------------------------------------
    const configHeader = document.getElementById('prompts-config-section-header');
    const configContent = document.getElementById('prompts-config-content');
    const includeBuiltInTemplates = document.getElementById('include-built-in-templates');
    const promptFolders = document.getElementById('prompt-folders');
    const savePromptsConfigBtn = document.getElementById('save-prompts-config-btn');

    // Configuration toggle
    if (configHeader && configContent) {
      configContent.style.display = 'none';
      configHeader.addEventListener('click', function () {
        const configSection = document.getElementById('prompts-config-section');
        configSection.classList.toggle('collapsed');
        if (configSection.classList.contains('collapsed')) {
          configContent.style.display = 'none';
        } else {
          configContent.style.display = 'block';
        }
      });
    }

    // Include built-in templates checkbox
    if (includeBuiltInTemplates) {
      // Set it as checked by default
      includeBuiltInTemplates.classList.add('checked');
      
      includeBuiltInTemplates.addEventListener('click', function () {
        this.classList.toggle('checked');
      });
    }

    // Save configuration button
    if (promptFolders && savePromptsConfigBtn) {
      // Set default values
      promptFolders.value = `.promptcode/prompts\n.cursor/rules\n.github/copilot-instructions.md\n.zed/\n.windsurfrules\n.clinerules\n.ai-rules/\nai-docs/`;
      
      savePromptsConfigBtn.addEventListener('click', () => {
        vscode.postMessage({
          command: 'savePromptsConfig',
          promptFolders: promptFolders.value,
          includeBuiltInTemplates: includeBuiltInTemplates.classList.contains('checked')
        });
      });
      
      // Request current configuration
      vscode.postMessage({ command: 'loadPromptsConfig' });
    }

    // ------------------------------------------------
    // 1) Setup the instruction text area & saving
    // ------------------------------------------------
    const textarea = document.querySelector('.instruction-textarea');
    const editorContainer = document.querySelector('.editor-container');
    let contentEditableDiv = null;
    
    // Create a contentEditable div to replace the textarea for richer editing
    if (textarea && editorContainer) {
      // Create contentEditable div with same styling as textarea
      contentEditableDiv = document.createElement('div');
      contentEditableDiv.className = 'instruction-textarea';
      contentEditableDiv.contentEditable = 'true';
      contentEditableDiv.spellcheck = false;
      
      // Create a hidden textarea to store raw text content
      const hiddenTextarea = document.createElement('textarea');
      hiddenTextarea.style.display = 'none';
      hiddenTextarea.id = 'raw-instruction-content';
      editorContainer.appendChild(hiddenTextarea);
      
      // Set CSS to preserve whitespace and line breaks
      contentEditableDiv.style.whiteSpace = 'pre-wrap';
      
      // Set placeholder text
      contentEditableDiv.setAttribute('data-placeholder', 'Write your instructions here... use @ to embed built-in and custom templates');
      
      // Transfer any existing value from textarea
      if (textarea.value) {
        contentEditableDiv.textContent = textarea.value;
      }
      
      // Replace textarea with contentEditable div
      editorContainer.replaceChild(contentEditableDiv, textarea);
      
      // Add input event listener for saving
      contentEditableDiv.addEventListener('input', debounce(() => {
        // Check if content is actually empty (just BR tags or whitespace)
        const contentIsEmpty = isContentEmpty(contentEditableDiv);
        
        // If it's empty, properly empty it to trigger the CSS placeholder
        if (contentIsEmpty) {
          contentEditableDiv.innerHTML = '';
        }
        
        saveInstructionContent();
        
        // Store the full HTML content instead of just text
        const hiddenTextarea = document.getElementById('raw-instruction-content');
        if (hiddenTextarea) {
          hiddenTextarea.value = contentEditableDiv.innerHTML;
        }
      }, 500));
      
      // Add input interceptor to handle HTML special characters
      contentEditableDiv.addEventListener('input', (e) => {
        // Get current content
        const content = contentEditableDiv.innerHTML;
        
        // Check if the content contains unescaped angle brackets
        // Create proper regex to match both opening and closing tags
        if (content.match(/<[^>]*>/)) {
          // Save current selection
          const selection = window.getSelection();
          const range = selection.getRangeCount() > 0 ? selection.getRangeAt(0).cloneRange() : null;
          
          // Process content to escape all angle brackets that aren't part of valid HTML
          let processedContent = content;
          
          // Create a temporary DOM element to safely parse the HTML
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = content;
          
          // Get the text content and convert it back to HTML with escaped brackets
          const plainText = tempDiv.textContent;
          const safeHtml = plainText
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
          
          // Only update if changes were made
          if (safeHtml !== content) {
            // Update content
            contentEditableDiv.innerHTML = safeHtml;
            
            // Restore selection if possible
            if (range) {
              // Try to restore selection approximately
              try {
                selection.removeAllRanges();
                selection.addRange(range);
              } catch (err) {
                console.error('Failed to restore selection:', err);
              }
            }
            
            // Save the updated content
            saveInstructionContent();
          }
        }
      });
      
      // Modify the paste event handler to handle content with angle brackets
      contentEditableDiv.addEventListener('paste', (e) => {
        e.preventDefault();
        
        // Get pasted text from clipboard
        const clipboardData = e.clipboardData || window.clipboardData;
        let pastedText = clipboardData.getData('text/plain');
        
        // Escape angle brackets in pasted text
        pastedText = pastedText
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        
        // Insert the escaped text
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          
          // Create a temporary div to convert to HTML nodes
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = pastedText;
          
          // Get all nodes from the div to insert
          const fragment = document.createDocumentFragment();
          while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
          }
          
          range.insertNode(fragment);
          
          // Move cursor to the end of pasted text
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
          
          // Save the content
          saveInstructionContent();
        }
      });
      
      // Add keydown event handler for special keys
      contentEditableDiv.addEventListener('keydown', (e) => {
        // Handle special keys like Backspace for template tags
        if (e.key === 'Backspace') {
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (range.collapsed) {
              // If cursor is right after a template tag, delete the whole tag
              const previousSibling = range.startContainer.previousSibling;
              if (previousSibling && previousSibling.nodeType === Node.ELEMENT_NODE && 
                  previousSibling.classList.contains('template-tag')) {
                e.preventDefault();
                previousSibling.remove();
                saveInstructionContent();
              }
            }
          }
        }
        // Handle Enter key to ensure consistent line break behavior
        else if (e.key === 'Enter') {
          e.preventDefault();
          
          // Insert a proper BR element
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            
            // Insert a single BR element first
            const br1 = document.createElement('br');
            range.insertNode(br1);
            
            // Move selection after the first BR
            range.setStartAfter(br1);
            range.setEndAfter(br1);
            
            // Insert a second BR element
            const br2 = document.createElement('br');
            range.insertNode(br2);
            
            // Move cursor after the first BR but before the second BR
            // This places cursor at the beginning of the new line
            range.setStartAfter(br1);
            range.setEndAfter(br1);
            range.collapse(true);
            
            // Update selection
            selection.removeAllRanges();
            selection.addRange(range);
            
            saveInstructionContent();
          }
        }
      });
    }

    /**
     * Sends the updated instruction text to the extension for saving
     */
    function saveInstructionContent() {
      if (contentEditableDiv) {
        // Get the HTML content and normalize line breaks
        const htmlContent = contentEditableDiv.innerHTML
          // Replace consecutive BR tags with a single one
          .replace(/<br\s*\/?><br\s*\/?>/gi, '<br>')
          // Ensure consistent BR tag format
          .replace(/<br\s*\/?>/gi, '<br>');
          
        const processedContent = processContentForSaving(htmlContent);
        
        vscode.postMessage({
          command: 'saveInstructions',
          instructions: processedContent
        });
      }
    }
    
    /**
     * Process the HTML content to convert template tags to the embedded instruction format
     * when saving to the extension
     */
    function processContentForSaving(htmlContent) {
      // Create a temporary div to parse the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;
      
      // Find all template tags and convert them FIRST
      const templateTags = tempDiv.querySelectorAll('.template-tag');
      templateTags.forEach(tag => {
        const promptName = tag.getAttribute('data-prompt-name');
        const filePath = tag.getAttribute('data-file-path'); // Get file path
        
        if (promptName) {
          // --- Added Logging Start ---
          console.log(`[Save Process] Found tag: ${tag.outerHTML}`);
          // --- Added Logging End ---

          // --- MODIFICATION START: Check if remote based on filePath ---
          const isRemote = filePath && filePath.startsWith('http');

          if (isRemote && filePath) {
            // Replace with fetch placeholder
            const fetchPlaceholder = `<fetch-instruction name="${escapeHtml(promptName)}" url="${escapeHtml(filePath)}" />`;
            tag.replaceWith(document.createTextNode(fetchPlaceholder));
            console.log(`[Save Process] Replaced tag with fetch placeholder for ${promptName}`);
          } else {
            // Local/Built-in: Get content from availablePrompts
            let promptContent = '';
            const prompt = availablePrompts.find(p => p.name === promptName);
            if (prompt) {
              promptContent = prompt.content;
            }

            console.log(`[Save Process] Final promptContent length for local ${promptName}: ${promptContent?.length ?? 0}`);
            
            if (promptContent) {
                 const embeddedText = `<embedded-instruction name="${escapeHtml(promptName)}">\n${promptContent}\n</embedded-instruction>`;
                 const embeddedInstruction = document.createTextNode(embeddedText);
                 tag.replaceWith(embeddedInstruction);
            } else {
              console.warn(`Content not found or empty for local prompt tag: ${promptName}. Replacing with text.`);
              tag.replaceWith(document.createTextNode(tag.textContent || `[@${promptName}-error]`)); 
            }
          }
           // --- MODIFICATION END ---

        } else {
          // --- NEW Fallback for tags without promptName (shouldn't happen but safety) ---
          console.warn('[Save Process] Found a template tag without data-prompt-name:', tag.outerHTML);
          tag.replaceWith(document.createTextNode(tag.textContent || '[@error-tag]'));
        }
      });

      // Now, convert BR elements to newlines
      const brs = tempDiv.querySelectorAll('br');
      brs.forEach(br => {
        br.replaceWith(document.createTextNode('\n'));
      });
      
      // Get the final text content with embedded instructions and newlines
      let processedContent = tempDiv.textContent;
      
      return processedContent;
    }
    
    // --- ADDED: Helper to escape HTML for attributes ---
    function escapeHtml(unsafe) {
      if (!unsafe) return '';
      return unsafe
           .replace(/&/g, "&amp;")
           .replace(/</g, "&lt;")
           .replace(/>/g, "&gt;")
           .replace(/"/g, "&quot;")
           .replace(/'/g, "&#039;");
    }

    /**
     * Process content from extension to display template tags
     */
    function processContentForDisplay(textContent) {
      // No need to replace placeholders back to angle brackets
      // since we're now using HTML entities
      
      // Find all embedded instructions using regex
      const embeddedRegex = /<embedded-instruction name="([^"]+)">([\s\S]*?)<\/embedded-instruction>/g;
      // --- NEW: Regex for fetch instructions ---
      const fetchRegex = /<fetch-instruction name="([^"]+)" url="([^"]+)" \/>/g;
      
      let lastIndex = 0;
      let result = '';
      let combinedMatches = [];

      // Find all matches for both types
      let match;
      while ((match = embeddedRegex.exec(textContent)) !== null) {
          combinedMatches.push({ type: 'embedded', index: match.index, length: match[0].length, name: match[1], content: match[2] });
      }
      while ((match = fetchRegex.exec(textContent)) !== null) {
          combinedMatches.push({ type: 'fetch', index: match.index, length: match.length, name: match[1], url: match[2] });
      }

      // Sort matches by index
      combinedMatches.sort((a, b) => a.index - b.index);

      // Process matches in order
      combinedMatches.forEach(matchInfo => {
          // Get text before the current match
          const beforeText = textContent.substring(lastIndex, matchInfo.index);
          result += beforeText.replace(/\n/g, '<br>');

          // --- MODIFICATION START: Handle both types ---
          const promptName = matchInfo.name;
          let filePathAttr = '';
          let tagClasses = 'template-tag';

          // Try to find the original prompt entry if available (might not always be up-to-date)
          const prompt = availablePrompts.find(p => p.name === promptName);

          if (matchInfo.type === 'fetch') {
              filePathAttr = ` data-file-path="${escapeHtml(matchInfo.url)}"`;
              tagClasses += ' remote-placeholder'; // Add specific class for visual styling
              console.log(`[Display Process] Creating remote placeholder tag for ${promptName}`);
          } else if (matchInfo.type === 'embedded') {
              // Try to get the file path from the original prompt data if found
              if (prompt && prompt.filePath) {
                 filePathAttr = ` data-file-path="${escapeHtml(prompt.filePath)}"`;
              }
              console.log(`[Display Process] Creating embedded tag for ${promptName}`);
              // We no longer store embedded content in the global map
          }

          // Construct the span tag
          result += `<span class="${tagClasses}" data-prompt-name="${escapeHtml(promptName)}"${filePathAttr} contenteditable="false">@${promptName}</span>`;
          // --- MODIFICATION END ---

          lastIndex = matchInfo.index + matchInfo.length;
      });
      
      // Add any remaining text
      const remainingText = textContent.substring(lastIndex);
      result += remainingText.replace(/\n/g, '<br>');
      
      return result;
    }

    // ------------------------------------------------
    // 2) Listen for "updateInstructions" from extension
    //    and apply to the instruction text area
    // ------------------------------------------------
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || !message.command) return;

      switch (message.command) {
        case 'updateInstructions':
          if (contentEditableDiv) {
            // Check if we have content in the hidden textarea first
            const hiddenTextarea = document.getElementById('raw-instruction-content');
            if (hiddenTextarea && hiddenTextarea.value) {
              // Use innerHTML instead of textContent to preserve formatting and template tags
              contentEditableDiv.innerHTML = hiddenTextarea.value;
            } else if (message.instructions) {
              // Process the instructions to display template tags
              const processedInstructions = processContentForDisplay(message.instructions);
              contentEditableDiv.innerHTML = processedInstructions;
            } else {
              contentEditableDiv.innerHTML = '';
            }
            
            // Add click handlers to template tags
            setupTemplateTagClickHandlers();
          }
          break;

        case 'loadPromptsConfig':
          if (includeBuiltInTemplates) {
            if (message.includeBuiltInTemplates) {
              includeBuiltInTemplates.classList.add('checked');
            } else {
              includeBuiltInTemplates.classList.remove('checked');
            }
          }
          
          if (promptFolders && message.promptFolders) {
            promptFolders.value = message.promptFolders;
          }
          break;

        default:
          // Ignore
          break;
      }
    });
    
    /**
     * Setup click handlers for template tags
     */
    function setupTemplateTagClickHandlers() {
      const templateTags = document.querySelectorAll('.template-tag');
      templateTags.forEach(tag => {
        tag.addEventListener('click', (e) => {
          // Prevent editor from getting focus
          e.preventDefault();
          e.stopPropagation();
          
          const promptName = tag.getAttribute('data-prompt-name');
          const filePath = tag.getAttribute('data-file-path');
          if (promptName) {
            // Send message to VSCode to open the prompt file
            vscode.postMessage({
              command: 'openPromptFile',
              promptName: promptName,
              filePath: filePath
            });
          }
        });
      });
    }

    // ------------------------------------------------
    // 3) Prompt Picker for embedding prompt templates
    // ------------------------------------------------
    setupPromptPicker();

    function setupPromptPicker() {
      const promptPicker = document.getElementById('prompt-picker');
      const promptList = document.querySelector('.prompt-list');
      if (!contentEditableDiv || !promptPicker || !promptList) return;

      let currentPosition = null;
      let currentRange = null;

      // Populate the prompt list with built-in + user prompts:
      populatePromptList();

      function populatePromptList() {
        // Group prompts by category
        const categorizedPrompts = {};
        const uncategorizedPrompts = [];

        // Split prompts into categorized and uncategorized
        availablePrompts.forEach(prompt => {
          if (prompt.category) {
            if (!categorizedPrompts[prompt.category]) {
              categorizedPrompts[prompt.category] = [];
            }
            categorizedPrompts[prompt.category].push(prompt);
          } else {
            uncategorizedPrompts.push(prompt);
          }
        });

        // Generate HTML for prompt list with categories and uncategorized items
        let promptListHtml = '';

        // First add uncategorized prompts at the root level
        uncategorizedPrompts.forEach(prompt => {
          promptListHtml += `
            <div class="prompt-item" data-prompt-name="${prompt.name}">
              <div>
                <div class="prompt-name">${prompt.name}</div>
                <div class="prompt-description">${prompt.description}</div>
              </div>
            </div>
          `;
        });

        // Then add the categories
        Object.keys(categorizedPrompts).sort().forEach(category => {
          promptListHtml += `
            <div class="prompt-category" data-category="${category}">
              <span class="prompt-category-icon"></span>
              <div class="prompt-category-name">${category}</div>
            </div>
            <div class="prompt-category-items" data-category="${category}">
              ${categorizedPrompts[category].map(prompt => `
                <div class="prompt-item" data-prompt-name="${prompt.name}">
                  <div>
                    <div class="prompt-name">${prompt.name}</div>
                    <div class="prompt-description">${prompt.description}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `;
        });

        promptList.innerHTML = promptListHtml;

        // Add click handlers for categories
        document.querySelectorAll('.prompt-category').forEach(categoryEl => {
          categoryEl.addEventListener('click', () => {
            const category = categoryEl.getAttribute('data-category');
            categoryEl.classList.toggle('open');
            
            // Find and toggle display of category items
            const categoryItems = document.querySelector(`.prompt-category-items[data-category="${category}"]`);
            if (categoryItems) {
              if (categoryEl.classList.contains('open')) {
                categoryItems.style.display = 'block';
              } else {
                categoryItems.style.display = 'none';
              }
            }
          });
        });
      }

      // On receiving updated prompts from extension:
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.command !== 'updatePrompts') return;
        console.log('Received updated prompts:', message.prompts.length);
        availablePrompts = message.prompts;
        // Refresh prompt list if the picker is open:
        if (promptPicker.style.display === 'block') {
          populatePromptList();
          filterPromptList('');
        }
      });

      function filterPromptList(searchLower) {
        let visibleCategories = new Set();
        let hasVisibleItems = false;

        // First hide all items that don't match
        const allItems = promptList.querySelectorAll('.prompt-item');
        allItems.forEach((item) => {
          const promptName = item.dataset.promptName.toLowerCase();
          const promptDesc = item.querySelector('.prompt-description')?.textContent.toLowerCase() || '';
          const isVisible = !searchLower || 
            promptName.includes(searchLower) || 
            promptDesc.includes(searchLower);

          item.style.display = isVisible ? 'flex' : 'none';
          
          if (isVisible) {
            hasVisibleItems = true;
            // Find parent category if it exists
            const categoryItems = item.closest('.prompt-category-items');
            if (categoryItems) {
              const categoryName = categoryItems.getAttribute('data-category');
              visibleCategories.add(categoryName);
            }
          }
        });

        // Now show/hide categories based on whether they have visible items
        const categories = promptList.querySelectorAll('.prompt-category');
        categories.forEach((category) => {
          const categoryName = category.getAttribute('data-category');
          const hasVisibleChildren = visibleCategories.has(categoryName);
          
          category.style.display = hasVisibleChildren ? 'flex' : 'none';
          
          // Open categories with visible children when searching
          if (searchLower && hasVisibleChildren) {
            category.classList.add('open');
            const categoryItems = document.querySelector(`.prompt-category-items[data-category="${categoryName}"]`);
            if (categoryItems) {
              categoryItems.style.display = 'block';
            }
          }
        });

        // Select the first visible item for keyboard navigation
        const visibleItems = Array.from(promptList.querySelectorAll('.prompt-item')).filter(
          (item) => item.style.display !== 'none'
        );

        if (visibleItems.length > 0) {
          allItems.forEach((item) => item.classList.remove('selected'));
          visibleItems[0].classList.add('selected');
        }
      }

      // Show/hide + arrow key handling:
      contentEditableDiv.addEventListener('input', (e) => {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return;
        
        const node = range.startContainer;
        const offset = range.startOffset;
        
        // Check if we're in a text node and the previous character is '@'
        if (node.nodeType === Node.TEXT_NODE && offset > 0 && node.nodeValue[offset - 1] === '@') {
          currentPosition = offset;
          currentRange = range.cloneRange();
          vscode.postMessage({ 
            command: 'requestPrompts',
            includeBuiltInTemplates: includeBuiltInTemplates?.classList.contains('checked') ?? true,
            promptFolders: promptFolders?.value ?? ''
          });

          // Position the picker near the caret
          const rect = range.getBoundingClientRect();
          const editorRect = contentEditableDiv.getBoundingClientRect();
          
          // Set position ensuring it doesn't overflow right edge
          promptPicker.style.top = `${rect.bottom + 5}px`;
          
          // Calculate left position, ensuring it stays within the editor bounds
          let leftPos = rect.left;
          const pickerWidth = 300; // Match the CSS width
          
          // Prevent overflow to the right
          if (leftPos + pickerWidth > editorRect.right) {
            leftPos = Math.max(editorRect.left, editorRect.right - pickerWidth);
          }
          
          promptPicker.style.left = `${leftPos}px`;
          promptPicker.style.display = 'block';

          // Reset the list:
          filterPromptList('');
          return;
        }

        // If we are currently showing the picker and we advanced the caret:
        if (currentPosition && node.nodeType === Node.TEXT_NODE && offset > currentPosition) {
          const filterText = node.nodeValue.substring(currentPosition, offset).toLowerCase();
          filterPromptList(filterText);
        }

        // If the user erased the "@" or moved elsewhere
        if (currentPosition && (node.nodeType !== Node.TEXT_NODE || 
            offset <= currentPosition - 1 || 
            (node.nodeType === Node.TEXT_NODE && offset > 0 && node.nodeValue[currentPosition - 1] !== '@'))) {
          promptPicker.style.display = 'none';
          currentPosition = null;
          currentRange = null;
        }
      });

      promptList.addEventListener('click', (e) => {
        const promptItem = e.target.closest('.prompt-item');
        if (!promptItem) return;
        insertPrompt(promptItem.dataset.promptName);
      });

      contentEditableDiv.addEventListener('keydown', (e) => {
        if (promptPicker.style.display !== 'block') return;
        
        // Find all visible prompt items
        const items = Array.from(promptList.querySelectorAll('.prompt-item'))
          .filter(item => item.style.display !== 'none');
        
        if (!items.length) return;

        let selectedIndex = items.findIndex((i) => i.classList.contains('selected'));

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          items.forEach((item) => item.classList.remove('selected'));
          
          if (e.key === 'ArrowDown') {
            selectedIndex = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
          } else {
            selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
          }
          
          items[selectedIndex].classList.add('selected');
          items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
        
        if (e.key === 'Enter' && selectedIndex >= 0) {
          e.preventDefault();
          insertPrompt(items[selectedIndex].dataset.promptName);
        }
        
        if (e.key === 'Escape') {
          promptPicker.style.display = 'none';
          currentPosition = null;
          currentRange = null;
        }
      });

      document.addEventListener('click', (e) => {
        if (!promptPicker.contains(e.target) && e.target !== contentEditableDiv) {
          promptPicker.style.display = 'none';
          currentPosition = null;
          currentRange = null;
        }
      });

      /**
       * Insert prompt template tag at the current cursor position, or request remote content
       */
      function insertPrompt(promptName) {
        const selectedPrompt = availablePrompts.find((p) => p.name === promptName);
        if (!selectedPrompt || !currentRange) return;

        // --- Get the current selection and range --- 
        const selection = window.getSelection();
        const range = currentRange.cloneRange();

        // --- Determine the replacement range --- 
        // Move range start to before the "@" character
        range.setStart(range.startContainer, currentPosition - 1);

        // Expand range end to cover any filter text after "@"
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          let endOffset = range.startContainer.nodeValue.length;
          // Find the end of the filter word (e.g., space or end of text)
          for (let i = currentPosition; i < range.startContainer.nodeValue.length; i++) {
            if (/\s/.test(range.startContainer.nodeValue[i])) {
              endOffset = i;
              break;
            }
          }
          range.setEnd(range.startContainer, endOffset);
        }

        // --- SIMPLIFIED: Always insert the standard tag --- 
        const templateTag = document.createElement('span');
        templateTag.className = 'template-tag'; // Base class
        templateTag.setAttribute('data-prompt-name', promptName);
        if (selectedPrompt.filePath) {
          templateTag.setAttribute('data-file-path', selectedPrompt.filePath);
          // Add remote class here if needed for immediate styling
          if (selectedPrompt.filePath.startsWith('http')) {
            templateTag.classList.add('remote-placeholder');
          }
        }
        templateTag.setAttribute('contenteditable', 'false');
        templateTag.textContent = `@${promptName}`;

        // Add click handler
        templateTag.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            vscode.postMessage({
              command: 'openPromptFile',
              promptName: promptName,
              filePath: selectedPrompt.filePath
            });
        });

        // Replace the "@filter" text with the template tag
        range.deleteContents();
        range.insertNode(templateTag);

        // Move cursor after the template tag
        range.setStartAfter(templateTag);
        range.setEndAfter(templateTag);
        range.collapse(false); // Collapse to end
        selection.removeAllRanges();
        selection.addRange(range);
        // --- END SIMPLIFIED INSERTION ---

        // --- Common cleanup --- 
        promptPicker.style.display = 'none';
        currentPosition = null;
        currentRange = null;
        saveInstructionContent(); // Save after insertion
      }
    }

    function debounce(fn, wait) {
      let timeout;
      return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(context, args), wait);
      };
    }
    
    /**
     * Helper function to insert text at the current cursor position
     */
    function insertTextAtCursor(text) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        
        // Move cursor to the end of inserted text
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Trigger a DOM change to ensure content is updated
        const inputEvent = new Event('input', {
          bubbles: true,
          cancelable: true,
        });
        contentEditableDiv.dispatchEvent(inputEvent);
      }
    }

    /**
     * Checks if the editor content is effectively empty (only whitespace or BR tags)
     */
    function isContentEmpty(element) {
      // Get content with all tags removed
      const textContent = element.textContent.trim();
      
      // Check if there's just a BR tag or empty
      const onlyBrTags = element.innerHTML.trim() === '<br>' || element.innerHTML.trim() === '';
      
      return textContent === '' || onlyBrTags;
    }
  }

  /* Export the initialization function to the global scope so it can be called from the HTML */
  window.initInstructionsTab = initInstructionsTab;
})(); 