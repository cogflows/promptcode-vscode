import { test, expect } from '@playwright/test';
import * as path from 'path';

// Use the strict CSP harness with proper loader
const harness = `file://${path.resolve(__dirname, 'harness-strict-csp-loader.html')}`;

test.describe('CSP Compliance Tests', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the test harness
        await page.goto(harness);
        
        // Clear any previous violations
        await page.evaluate(() => {
            if (window.testHelpers) {
                window.testHelpers.clearCSPViolations();
            }
        });
    });
    
    test.afterEach(async ({ page }) => {
        // Check for CSP violations after each test
        const violations = await page.evaluate(() => {
            return window.testHelpers ? window.testHelpers.getCSPViolations() : [];
        });
        
        // Fail if any violations occurred
        if (violations.length > 0) {
            console.error('CSP Violations detected:', violations);
        }
        expect(violations).toHaveLength(0);
    });
    
    test('no CSP violations on page load', async ({ page }) => {
        // Wait for page to fully load
        await page.waitForLoadState('networkidle');
        
        // Check for violations
        const violations = await page.evaluate(() => {
            return window.testHelpers ? window.testHelpers.getCSPViolations() : [];
        });
        
        expect(violations).toHaveLength(0);
    });
    
    test('no CSP violations when interacting with checkboxes', async ({ page }) => {
        // Wait for file tree to be available
        await page.waitForSelector('.file-checkbox', { timeout: 5000 });
        
        // Click on checkboxes
        const checkboxes = await page.$$('.file-checkbox');
        for (const checkbox of checkboxes) {
            await checkbox.click();
        }
        
        // Check for violations
        const violations = await page.evaluate(() => {
            return window.testHelpers ? window.testHelpers.getCSPViolations() : [];
        });
        
        expect(violations).toHaveLength(0);
    });
    
    test('no CSP violations when expanding folders', async ({ page }) => {
        // Wait for folder items
        await page.waitForSelector('.tree-item.folder', { timeout: 5000 });
        
        // Click on folder to expand
        await page.click('.tree-item.folder');
        
        // Check for violations
        const violations = await page.evaluate(() => {
            return window.testHelpers ? window.testHelpers.getCSPViolations() : [];
        });
        
        expect(violations).toHaveLength(0);
    });
    
    test('no CSP violations when clicking buttons', async ({ page }) => {
        // Test all buttons on the page
        const buttons = await page.$$('button');
        
        for (const button of buttons) {
            // Skip if button is disabled
            const isDisabled = await button.isDisabled();
            if (!isDisabled) {
                await button.click();
            }
        }
        
        // Check for violations
        const violations = await page.evaluate(() => {
            return window.testHelpers ? window.testHelpers.getCSPViolations() : [];
        });
        
        expect(violations).toHaveLength(0);
    });
    
    test('no inline event handlers in HTML', async ({ page }) => {
        // Check for inline event handlers in the HTML
        const hasInlineHandlers = await page.evaluate(() => {
            const elements = document.querySelectorAll('*');
            const inlineHandlers = [];
            
            elements.forEach(el => {
                // Check for common inline event attributes
                const eventAttrs = ['onclick', 'onchange', 'onload', 'onerror', 'onsubmit', 
                                   'onfocus', 'onblur', 'onkeydown', 'onkeyup', 'onmouseover',
                                   'onmouseout', 'onmousedown', 'onmouseup'];
                
                eventAttrs.forEach(attr => {
                    if (el.hasAttribute(attr)) {
                        inlineHandlers.push({
                            element: el.tagName,
                            attribute: attr,
                            value: el.getAttribute(attr)
                        });
                    }
                });
            });
            
            return inlineHandlers;
        });
        
        expect(hasInlineHandlers).toHaveLength(0);
    });
    
    test('scripts have proper nonce attributes', async ({ page }) => {
        // Check that all scripts have nonce attributes
        const scriptsWithoutNonce = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            return scripts
                .filter(script => !script.nonce && !script.src.includes('harness-setup.js'))
                .map(script => ({
                    src: script.src || 'inline',
                    hasNonce: !!script.nonce
                }));
        });
        
        expect(scriptsWithoutNonce).toHaveLength(0);
    });
});