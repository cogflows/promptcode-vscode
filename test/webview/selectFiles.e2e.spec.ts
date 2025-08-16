import { test, expect } from '@playwright/test';
import * as path from 'path';

const harness = `file://${path.resolve(__dirname, 'harness.html')}`;

// Helper function to open the Select Files tab
async function openSelectFilesTab(page) {
  // Navigate to the test harness
  await page.goto(harness);
  
  // The select files tab should be active by default, but click it to be sure
  const selectFilesTab = page.locator('.tab-trigger[data-tab="selectFiles"]');
  await selectFilesTab.click();
  
  // Wait for the tab content to be visible
  await page.waitForSelector('#selected-files-list', { state: 'visible' });
}

test('trash icon deletes first directory header', async ({ page }) => {
  // Open the Select Files tab
  await openSelectFilesTab(page);

  // Count the initial number of directory headers
  const initialHeaderCount = await page.locator('.directory-header').count();
  
  // Find and click the trash button in the first directory header
  const firstTrash = page.locator('.directory-header >> nth=0 >> .trash-btn');
  await firstTrash.click();

  // The header should be gone, so the count should be one less
  await expect(page.locator('.directory-header')).toHaveCount(initialHeaderCount - 1);
});

test('files are sorted by token count descending', async ({ page }) => {
  // Open the Select Files tab
  await openSelectFilesTab(page);

  // Wait for files to be loaded
  await page.waitForSelector('.selected-file-item');

  // Get all token count values
  const tokenTexts = await page.locator('.selected-file-item .token-count').allTextContents();
  
  // Parse the token values (e.g., "1.50k tokens (25.0%)" -> 1500)
  const tokenValues = tokenTexts.map(text => {
    const match = text.match(/(\d+\.\d+)k/);
    return match ? parseFloat(match[1]) * 1000 : 0;
  });

  // Verify they are sorted in descending order
  const sortedValues = [...tokenValues].sort((a, b) => b - a);
  expect(tokenValues).toEqual(sortedValues);
}); 