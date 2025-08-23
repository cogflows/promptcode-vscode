/**
 * Simplified setup for strict CSP testing
 * Uses static nonce 'testnonce' defined in HTML
 */

// Track CSP violations for testing
window.__CSP_VIOLATIONS__ = [];
window.addEventListener('securitypolicyviolation', (e) => {
    const violation = {
        directive: e.violatedDirective,
        blockedURI: e.blockedURI || 'inline',
        sourceFile: e.sourceFile,
        sample: e.sample
    };
    window.__CSP_VIOLATIONS__.push(violation);
    console.error('CSP Violation:', violation);
});

// Mock VS Code API
window.vscode = {
    postMessage: (msg) => {
        console.log('Message to extension:', msg);
        window.__sentMessages = window.__sentMessages || [];
        window.__sentMessages.push(msg);
    },
    getState: () => ({}),
    setState: () => {}
};
window.acquireVsCodeApi = () => window.vscode;

// Test helpers
window.testHelpers = {
    getCSPViolations: () => window.__CSP_VIOLATIONS__,
    clearCSPViolations: () => { window.__CSP_VIOLATIONS__ = []; }
};