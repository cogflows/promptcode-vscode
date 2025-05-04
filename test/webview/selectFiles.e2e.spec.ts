import { test, expect } from '@playwright/test';

// Helper function to open the Select Files tab
async function openSelectFilesTab(page) {
  // Navigate to the webview (this will need to be adjusted based on how your extension is served during tests)
  await page.goto('vscode-webview://your-extension-id');

  // Click on the Select Files tab
  const selectFilesTab = page.locator('.tab-trigger[data-tab="files"]');
  await selectFilesTab.click();
  
  // Wait for the tab content to load
  await page.waitForSelector('#selected-files-list');
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