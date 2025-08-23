/**
 * Setup script for strict CSP test harness
 * This simulates VS Code's CSP environment
 */

// Generate a nonce like VS Code does
function generateNonce() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Store nonce globally for scripts to use
const nonce = generateNonce();
window.__CSP_NONCE__ = nonce;

// Apply CSP meta tag matching VS Code's production settings
const cspMeta = document.createElement('meta');
cspMeta.httpEquiv = 'Content-Security-Policy';
cspMeta.content = `
    default-src 'none';
    style-src 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src data:;
    img-src data: https:;
`.replace(/\s+/g, ' ').trim();

// Insert CSP before any scripts run
document.head.insertBefore(cspMeta, document.head.firstChild);

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

// Apply nonce to all script tags
document.querySelectorAll('script').forEach(script => {
    if (!script.nonce && !script.src.includes('harness-setup.js')) {
        script.nonce = nonce;
    }
});

// Mock VS Code API with CSP-safe implementation
const vscode = (() => {
    const state = {};
    const messageHandlers = [];
    
    return {
        postMessage: (message) => {
            console.log('Message to extension:', message);
            
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