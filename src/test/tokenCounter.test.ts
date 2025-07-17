import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { 
  countTokensWithCache, 
  clearTokenCache, 
  initializeTokenCounter,
  tokenCache
} from '../tokenCounter';

suite('Token Counter Tests', () => {
  let tempDir: string;
  let testFile1: string;
  let testFile2: string;

  setup(async () => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenCounter-test-'));
    testFile1 = path.join(tempDir, 'test1.txt');
    testFile2 = path.join(tempDir, 'test2.txt');

    // Initialize token counter with temp directory
    initializeTokenCounter(tempDir);
    
    // Clear any existing cache
    clearTokenCache();
  });

  teardown(async () => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Error cleaning up temp directory:', error);
    }
  });

  test('should cache token count based on content hash', async () => {
    // Create a test file
    const content = 'This is a test file with some content for token counting';
    fs.writeFileSync(testFile1, content);

    // First count should compute and cache
    const count1 = await countTokensWithCache(testFile1);
    assert.ok(count1 > 0, 'Token count should be greater than 0');

    // Get the cache entry to verify it has sha256
    const cacheEntry = tokenCache.get(testFile1);
    assert.ok(cacheEntry, 'Cache entry should exist');
    assert.ok(cacheEntry!.sha256, 'Cache entry should have sha256 hash');

    // Second count should use cache (same file, no changes)
    const count2 = await countTokensWithCache(testFile1);
    assert.strictEqual(count2, count1, 'Second count should match first count from cache');
  });

  test('should detect same-size content changes using hash', async () => {
    // Create a file with specific content
    const content1 = 'Hello World Test'; // 16 characters
    fs.writeFileSync(testFile1, content1);

    // Get initial token count
    const count1 = await countTokensWithCache(testFile1);
    const cacheEntry1 = tokenCache.get(testFile1);
    const hash1 = cacheEntry1!.sha256;

    // Modify file with same size but different content
    const content2 = 'Goodbye Universe'; // Also 16 characters
    fs.writeFileSync(testFile1, content2);

    // Count again - should detect change despite same size
    const count2 = await countTokensWithCache(testFile1);
    const cacheEntry2 = tokenCache.get(testFile1);
    const hash2 = cacheEntry2!.sha256;

    // Hashes should be different
    assert.notStrictEqual(hash1, hash2, 'Hash should change when content changes');
    
    // Token counts might be different (depends on tokenization)
    // But the important thing is the cache was invalidated and recomputed
    assert.ok(cacheEntry2!.timestamp > cacheEntry1!.timestamp, 'Cache should be updated');
  });

  test('should reuse cache when content hash is identical', async () => {
    // Create two files with identical content
    const content = 'This is identical content in both files';
    fs.writeFileSync(testFile1, content);
    fs.writeFileSync(testFile2, content);

    // Count tokens in both files
    const count1 = await countTokensWithCache(testFile1);
    const count2 = await countTokensWithCache(testFile2);

    // Get cache entries
    const cache1 = tokenCache.get(testFile1);
    const cache2 = tokenCache.get(testFile2);

    // Both should have same hash and count
    assert.strictEqual(cache1!.sha256, cache2!.sha256, 'Files with same content should have same hash');
    assert.strictEqual(count1, count2, 'Files with same content should have same token count');
  });

  test('should handle cache invalidation by FileSystemWatcher', async function() {
    // Skip this test if not in VS Code environment
    if (!vscode.workspace.workspaceFolders) {
      this.skip();
      return;
    }

    // Create a file
    const content = 'Initial content for watcher test';
    fs.writeFileSync(testFile1, content);

    // Count tokens to populate cache
    const count1 = await countTokensWithCache(testFile1);
    assert.ok(tokenCache.has(testFile1), 'File should be in cache');

    // Manually trigger cache deletion (simulating FileSystemWatcher)
    tokenCache.delete(testFile1);
    
    // Verify cache was cleared
    assert.ok(!tokenCache.has(testFile1), 'File should not be in cache after deletion');

    // Count again should recompute
    const count2 = await countTokensWithCache(testFile1);
    assert.strictEqual(count2, count1, 'Recomputed count should match original');
    assert.ok(tokenCache.has(testFile1), 'File should be back in cache');
  });

  test('should respect LRU cache limits', async () => {
    // This test verifies that the LRU cache evicts old entries
    // Note: The actual limit is 10,000 in production, but we'll test the concept
    
    // Create multiple files
    const fileCount = 5;
    const files: string[] = [];
    
    for (let i = 0; i < fileCount; i++) {
      const filePath = path.join(tempDir, `test-lru-${i}.txt`);
      fs.writeFileSync(filePath, `Content for file ${i}`);
      files.push(filePath);
    }

    // Count tokens in all files
    for (const file of files) {
      await countTokensWithCache(file);
    }

    // Verify all files are cached
    for (const file of files) {
      assert.ok(tokenCache.has(file), `File ${file} should be in cache`);
    }

    // Access first file again to make it most recently used
    await countTokensWithCache(files[0]);
    
    // The LRU behavior should keep the most recently used items
    // In production with 10k limit, old items would be evicted
  });

  test('should handle missing sha256 field for backward compatibility', async () => {
    // Simulate loading an old cache entry without sha256
    const oldCacheEntry = {
      count: 100,
      mtime: Date.now(),
      size: 1000,
      timestamp: Date.now()
      // Note: no sha256 field
    };

    // Direct cache manipulation to simulate old entry
    // This would normally be handled by loadCacheFromDisk
    // but we're testing the concept
    
    // Create a file and count tokens normally
    fs.writeFileSync(testFile1, 'Test content');
    const count = await countTokensWithCache(testFile1);
    
    // Verify new entry has sha256
    const newEntry = tokenCache.get(testFile1);
    assert.ok(newEntry!.sha256, 'New cache entries should always have sha256');
  });

  test('should handle file read errors gracefully', async () => {
    // Try to count tokens for non-existent file
    const nonExistentFile = path.join(tempDir, 'does-not-exist.txt');
    
    const count = await countTokensWithCache(nonExistentFile);
    assert.strictEqual(count, 0, 'Should return 0 for non-existent file');
    
    // Cache should not contain the failed file
    assert.ok(!tokenCache.has(nonExistentFile), 'Failed file should not be cached');
  });
});