/**
 * Setup script for strict CSP test harness
 * This runs with the proper nonce already set
 */

// Add CSP violation tracking
window.__CSP_VIOLATIONS__ = [];
window.addEventListener('securitypolicyviolation', (e) => {
    const violation = {
        directive: e.violatedDirective,
        blockedURI: e.blockedURI || 'inline',
        lineNumber: e.lineNumber,
        columnNumber: e.columnNumber,
        sourceFile: e.sourceFile,
        sample: e.sample,
        timestamp: Date.now()
    };
    
    window.__CSP_VIOLATIONS__.push(violation);
    
    // Log for debugging
    console.error('CSP Violation:', violation);
    
    // Fail tests if violations occur
    if (window.__TEST_FAIL_ON_CSP_VIOLATION__) {
        throw new Error(`CSP Violation: ${violation.directive} blocked ${violation.blockedURI}`);
    }
});

// Mock VS Code API with CSP-safe implementation
const vscode = (() => {
    const state = {};
    const messageHandlers = [];
    
    return {
        postMessage: (message) => {
            console.log('Message to extension:', message);
            
            // Track sent messages for testing
            window.__sentMessages = window.__sentMessages || [];
            window.__sentMessages.push(message);
            
            // Simulate responses using setTimeout (CSP-safe)
            setTimeout(() => {
                switch(message.command) {
                    case 'getSelectedFiles':
                        window.postMessage({
                            command: 'updateSelectedFiles',
                            files: []
                        }, '*');
                        break;
                    case 'getTokenCounts':
                        window.postMessage({
                            command: 'updateTokenCounts',
                            tokenCounts: {}
                        }, '*');
                        break;
                }
            }, 10);
        },
        setState: (newState) => {
            Object.assign(state, newState);
        },
        getState: () => state
    };
})();

// Make it available globally
window.acquireVsCodeApi = () => vscode;
window.vscode = vscode; // Some code might access directly

// Set up script loaded flags
window._scriptLoaded = {
    selectFilesTab: false,
    instructionsTab: false,
    generatePromptTab: false,
    mergeTab: false,
    webview: false
};

// Helper to check for CSP violations in tests
window.checkForCSPViolations = () => {
    return window.__CSP_VIOLATIONS__;
};

// Helper to clear CSP violations
window.clearCSPViolations = () => {
    window.__CSP_VIOLATIONS__ = [];
};