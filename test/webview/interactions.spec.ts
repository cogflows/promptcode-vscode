import { test, expect } from '@playwright/test';
import * as path from 'path';

// Use the strict CSP harness with proper loader for all interaction tests
const harness = `file://${path.resolve(__dirname, 'harness-strict-csp-loader.html')}`;

test.describe('Webview Interaction Tests', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(harness);
        
        // Wait for initial load
        await page.waitForLoadState('networkidle');
    });
    
    test('file checkbox selection works', async ({ page }) => {
        // Wait for checkboxes to be available
        await page.waitForSelector('.file-checkbox');
        
        // Get initial state
        const checkbox = page.locator('.file-checkbox[data-path="/src/index.ts"]');
        await expect(checkbox).not.toBeChecked();
        
        // Click checkbox
        await checkbox.click();
        
        // Verify it's checked
        await expect(checkbox).toBeChecked();
        
        // Click again to uncheck
        await checkbox.click();
        await expect(checkbox).not.toBeChecked();
    });
    
    test('folder expansion and collapse works', async ({ page }) => {
        // Wait for folder to be available
        await page.waitForSelector('.tree-item.folder');
        
        const folder = page.locator('.tree-item.folder[data-path="/src"]');
        
        // Initially not expanded
        await expect(folder).not.toHaveClass(/expanded/);
        
        // Click to expand
        await folder.click();
        
        // Should be expanded
        await expect(folder).toHaveClass(/expanded/);
        
        // Click to collapse
        await folder.click();
        
        // Should be collapsed
        await expect(folder).not.toHaveClass(/expanded/);
    });
    
    test('tab switching works', async ({ page }) => {
        // Get all tab triggers
        const selectFilesTab = page.locator('.tab-trigger[data-tab="selectFiles"]');
        const instructionsTab = page.locator('.tab-trigger[data-tab="instructions"]');
        const generateTab = page.locator('.tab-trigger[data-tab="generate"]');
        const applyTab = page.locator('.tab-trigger[data-tab="apply"]');
        
        // Initially select files tab is active
        await expect(selectFilesTab).toHaveClass(/active/);
        await expect(page.locator('#selectFilesTab')).toHaveClass(/active/);
        
        // Switch to instructions tab
        await instructionsTab.click();
        await expect(instructionsTab).toHaveClass(/active/);
        await expect(selectFilesTab).not.toHaveClass(/active/);
        
        // Switch to generate tab
        await generateTab.click();
        await expect(generateTab).toHaveClass(/active/);
        await expect(instructionsTab).not.toHaveClass(/active/);
        
        // Switch to apply tab
        await applyTab.click();
        await expect(applyTab).toHaveClass(/active/);
        await expect(generateTab).not.toHaveClass(/active/);
        
        // Switch back to select files
        await selectFilesTab.click();
        await expect(selectFilesTab).toHaveClass(/active/);
        await expect(applyTab).not.toHaveClass(/active/);
    });
    
    test('select all and deselect all buttons work', async ({ page }) => {
        // Wait for buttons
        await page.waitForSelector('#selectAllBtn');
        await page.waitForSelector('#deselectAllBtn');
        await page.waitForSelector('.file-checkbox');
        
        const selectAllBtn = page.locator('#selectAllBtn');
        const deselectAllBtn = page.locator('#deselectAllBtn');
        const checkboxes = page.locator('.file-checkbox');
        
        // Initially unchecked
        const count = await checkboxes.count();
        for (let i = 0; i < count; i++) {
            await expect(checkboxes.nth(i)).not.toBeChecked();
        }
        
        // Click select all
        await selectAllBtn.click();
        
        // All should be checked
        for (let i = 0; i < count; i++) {
            await expect(checkboxes.nth(i)).toBeChecked();
        }
        
        // Click deselect all
        await deselectAllBtn.click();
        
        // All should be unchecked
        for (let i = 0; i < count; i++) {
            await expect(checkboxes.nth(i)).not.toBeChecked();
        }
    });
    
    test('trash button removes directory and files', async ({ page }) => {
        // Wait for directory headers
        await page.waitForSelector('.directory-header');
        
        // Count initial headers
        const initialCount = await page.locator('.directory-header').count();
        expect(initialCount).toBeGreaterThan(0);
        
        // Find first trash button and click it
        const firstTrashBtn = page.locator('.trash-btn').first();
        await firstTrashBtn.click();
        
        // Should have one less header
        const newCount = await page.locator('.directory-header').count();
        expect(newCount).toBe(initialCount - 1);
    });
    
    test('search input updates clear button visibility', async ({ page }) => {
        // Wait for search elements
        await page.waitForSelector('#file-search');
        await page.waitForSelector('#clear-search');
        
        const searchInput = page.locator('#file-search');
        const clearBtn = page.locator('#clear-search');
        
        // Initially clear button might be hidden
        // Type in search
        await searchInput.fill('test');
        
        // Clear button should be visible/enabled
        await expect(clearBtn).toBeVisible();
        
        // Click clear
        await clearBtn.click();
        
        // Search should be empty
        await expect(searchInput).toHaveValue('');
    });
    
    test('keyboard navigation works', async ({ page }) => {
        // Focus on first checkbox
        await page.locator('.file-checkbox').first().focus();
        
        // Press space to toggle
        await page.keyboard.press('Space');
        
        // Should be checked
        await expect(page.locator('.file-checkbox').first()).toBeChecked();
        
        // Press tab to move to next element
        await page.keyboard.press('Tab');
        
        // The focused element should change
        const focusedElement = await page.evaluate(() => {
            return document.activeElement?.className || '';
        });
        
        expect(focusedElement).toBeTruthy();
    });
    
    test('messages are sent to VS Code API', async ({ page }) => {
        // Set up message tracking
        const messages = await page.evaluate(() => {
            const msgs: any[] = [];
            // Override postMessage to track
            const originalPost = window.vscode.postMessage;
            window.vscode.postMessage = (msg: any) => {
                msgs.push(msg);
                originalPost.call(window.vscode, msg);
            };
            return msgs;
        });
        
        // Perform actions that should send messages
        await page.locator('.file-checkbox').first().click();
        
        // Check that message was sent
        const sentMessages = await page.evaluate(() => {
            // @ts-ignore
            return window.__sentMessages || [];
        });
        
        // Should have sent at least one message
        expect(sentMessages.length).toBeGreaterThan(0);
    });
});