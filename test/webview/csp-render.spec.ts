import { test, expect } from '@playwright/test';
import * as path from 'path';

const harness = `file://${path.resolve(__dirname, 'strict-csp.html')}`;

test.describe('CSP Render Safety', () => {
    test('rendered HTML contains no inline handlers', async ({ page }) => {
        await page.goto(harness);
        
        // Simulate VS Code sending selected files
        await page.evaluate(() => {
            // Mock some selected files data
            const testData = {
                command: 'updateSelectedFiles',
                selectedFiles: [
                    { path: 'src/index.ts', tokenCount: 1000 },
                    { path: 'src/utils.ts', tokenCount: 500 }
                ],
                totalTokens: 1500
            };
            
            // If the webview script is listening, it would handle this
            window.postMessage(testData, '*');
        });
        
        // Wait for body to be ready
        await page.waitForSelector('body');
        
        // Get the entire body HTML
        const bodyHtml = await page.locator('body').innerHTML();
        
        // Check for inline event handlers (onclick, onchange, etc.)
        expect(bodyHtml).not.toMatch(/\son[a-z]+\s*=/i);
        
        // Check for javascript: URLs
        expect(bodyHtml).not.toMatch(/javascript:/i);
        
        // Verify no CSP violations occurred
        const violations = await page.evaluate(() => {
            return window.testHelpers ? window.testHelpers.getCSPViolations() : [];
        });
        expect(violations).toHaveLength(0);
    });
    
    test('all scripts have proper nonce', async ({ page }) => {
        await page.goto(harness);
        
        // Check that all script tags have the expected nonce
        const scriptsWithoutNonce = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            return scripts
                .filter(script => script.nonce !== 'testnonce')
                .map(script => script.src || 'inline script');
        });
        
        expect(scriptsWithoutNonce).toHaveLength(0);
    });
});