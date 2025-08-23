import { test, expect } from '@playwright/test';
import * as path from 'path';

const harness = `file://${path.resolve(__dirname, 'strict-csp.html')}`;

test.describe('CSP Protection Tests', () => {
    test('no CSP violations on page load', async ({ page }) => {
        await page.goto(harness);
        await page.waitForLoadState('networkidle');
        
        const violations = await page.evaluate(() => {
            return window.testHelpers ? window.testHelpers.getCSPViolations() : [];
        });
        
        expect(violations).toHaveLength(0);
    });
    
    test('UI interactions work without CSP violations', async ({ page }) => {
        await page.goto(harness);
        await page.waitForSelector('.file-checkbox');
        
        // Clear any previous violations
        await page.evaluate(() => window.testHelpers.clearCSPViolations());
        
        // Click checkboxes
        const checkboxes = await page.$$('.file-checkbox');
        for (const checkbox of checkboxes) {
            await checkbox.click();
        }
        
        // Click buttons
        await page.click('#selectAllBtn');
        await page.click('#deselectAllBtn');
        
        // Expand folders
        const folders = await page.$$('.folder');
        for (const folder of folders) {
            await folder.click();
        }
        
        // Check for violations
        const violations = await page.evaluate(() => {
            return window.testHelpers.getCSPViolations();
        });
        
        expect(violations).toHaveLength(0);
    });
});