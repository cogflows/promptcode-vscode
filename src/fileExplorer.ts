import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IgnoreHelper } from './ignoreHelper';
import { LRUCache } from 'lru-cache';

// Global singleton pattern to ensure the same Maps are used across all module instances
// This fixes the "two copies of the module" problem in VS Code extension tests
declare global {
   
  var __promptcodeFileExplorerState: {
    checkedItems: Map<string, vscode.TreeItemCheckboxState>;
    expandedItems: Map<string, boolean>;
  } | undefined;
}

const g = globalThis as typeof globalThis & {
  __promptcodeFileExplorerState?: {
    checkedItems: Map<string, vscode.TreeItemCheckboxState>;
    expandedItems: Map<string, boolean>;
  };
};

// Initialize the global state if it doesn't exist
if (!g.__promptcodeFileExplorerState) {
  g.__promptcodeFileExplorerState = {
    checkedItems: new Map(),
    expandedItems: new Map(),
  };
}

// Export the shared singletons
// Map to keep track of checked items
export const checkedItems = g.__promptcodeFileExplorerState.checkedItems;
// Map to track expanded nodes
export const expandedItems = g.__promptcodeFileExplorerState.expandedItems;

export class FileItem extends vscode.TreeItem {
  // ... (rest of the FileItem class remains the same) ...
  public readonly workspaceFolderName?: string;
  public readonly workspaceFolderRootPath?: string;

  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly isDirectory: boolean,
    public readonly fullPath: string,
    public readonly displayName?: string // Optional display name
  ) {
    // Use display name if provided, otherwise use filename
    super(displayName || path.basename(fullPath), collapsibleState);

    // Set context value to differentiate directories and files
    this.contextValue = isDirectory ? 'directory' : 'file';

    // Set checkbox state
    this.checkboxState = checkedItems.get(fullPath) ?? vscode.TreeItemCheckboxState.Unchecked;

    // Use relative path for tooltip when possible
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
    if (workspaceFolder) {
      const relativePath = path.relative(workspaceFolder.uri.fsPath, fullPath);
      this.tooltip = `${workspaceFolder.name}: ${relativePath}`;

      // Add workspace information
      this.workspaceFolderName = workspaceFolder.name;
      this.workspaceFolderRootPath = workspaceFolder.uri.fsPath;
    } else {
      this.tooltip = fullPath;
    }

    // Add command to open file when clicking on the label (not checkbox)
    if (!isDirectory) {
      this.command = {
        command: 'promptcode.openFileFromTree',
        title: 'Open File',
        arguments: [resourceUri]
      };
    }
  }
}


export class FileExplorerProvider implements vscode.TreeDataProvider<FileItem>, vscode.FileDecorationProvider {
  // ... (existing properties remain the same) ...
  private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null | void> = new vscode.EventEmitter<FileItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null | void> = this._onDidChangeTreeData.event;
  private context: vscode.ExtensionContext | undefined;
  private searchTerm: string = '';
  private isGlobSearch: boolean = false;
  private includeFoldersInSearch: boolean = false;
  private cachedEntries: LRUCache<string, fs.Dirent[]>;
  private _treeView: vscode.TreeView<FileItem> | undefined;
  private disposables: vscode.Disposable[] = [];
  private ignoreHelper: IgnoreHelper | undefined;
  
  // FileDecorationProvider properties
  private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> = this._onDidChangeFileDecorations.event;
  private workspaceRoots: Map<string, string> = new Map(); // Uri string -> fsPath
  private includedPaths: Set<string> = new Set();
  private checkboxQueue: Promise<void> = Promise.resolve(); // Added queue field
  private searchSequence: number = 0; // For search cancellation
  
  // New: Aggregated directory selection state for O(1) decoration lookups
  private dirSelectionAgg: Map<string, { total: number; checked: number }> = new Map();
  private searchTimer: NodeJS.Timeout | null = null; // For debouncing
  private pendingSearch: Promise<void> | null = null; // For proper async handling
  private pendingSearchResolver: ((value: void | PromiseLike<void>) => void) | null = null; // To resolve superseded searches
  
  // Flat file index for fast searches
  private flatFileIndex: Map<string, {
    path: string;
    name: string;
    isDirectory: boolean;
    relativePath: string;
    workspaceRoot: string;
  }> = new Map();
  private indexBuildPromise: Promise<void> | null = null;
  private indexNeedsRebuild: boolean = true;
  private ignoreReadyPromise?: Promise<void>;
  
  // Track direct file matches for single-result auto-select
  private lastDirectFileMatches: string[] = [];

  constructor() {
    console.log('[FileExplorer Constructor] Starting initialization');
    console.log('[FileExplorer Constructor] vscode.workspace.workspaceFolders:', vscode.workspace.workspaceFolders);
    
    // Initialize LRU cache for directory entries
    // Max 1000 directories, TTL 5 minutes
    this.cachedEntries = new LRUCache<string, fs.Dirent[]>({
      max: 1000,
      ttl: 5 * 60 * 1000, // 5 minutes in milliseconds
      updateAgeOnGet: true, // Reset TTL on access
      updateAgeOnHas: true
    });
    
    // ... (constructor initialization remains the same) ...
    // Initialize workspace roots and build index asynchronously
    // This also initializes the ignore helper before building the index
    this.initializeWorkspaceRoots().then(() => {
      // Refresh the tree view after everything is initialized
      this.refresh();
    }).catch(error => {
      console.error('[FileExplorer Constructor] Error initializing workspace roots:', error);
    });

    // Set up file system watchers for all workspace folders
    this.setupFileSystemWatchers();

    // Listen for workspace folder changes
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(e => {
        this.handleWorkspaceFoldersChanged(e).catch(error => {
          console.error('Error handling workspace folder change:', error);
        });
      })
    );

    // Also listen for VS Code's built-in file events
    this.disposables.push(
      vscode.workspace.onDidCreateFiles(() => this.refresh()),
      vscode.workspace.onDidDeleteFiles(() => this.refresh()),
      vscode.workspace.onDidRenameFiles(e => {
        // Remove old paths from index on rename
        for (const f of e.files) {
          this.flatFileIndex.delete(f.oldUri.fsPath);
          // Don't eagerly stat new file; mark dirty so next search rebuilds
        }
        this.invalidateIndex();
        this.refresh();
      })
    );
  }

  // ... (rest of the FileExplorerProvider class remains the same) ...
  
  private ensureIgnoreHelperReady(forceReload: boolean = false): Promise<void> {
    if (!this.ignoreHelper) {
      this.ignoreHelper = new IgnoreHelper();
    }
    if (forceReload) {
      this.ignoreReadyPromise = undefined;
    }
    if (!this.ignoreReadyPromise) {
      // Single flight for initial ignore load
      this.ignoreReadyPromise = this.ignoreHelper.initialize().catch(err => {
        console.error('IgnoreHelper initialize failed:', err);
        // Keep promise resolved to avoid hanging initialization even if ignore load fails
      }) as Promise<void>;
    }
    return this.ignoreReadyPromise;
  }
  
  public async initializeWorkspaceRoots(): Promise<void> {
    console.log('[InitWorkspaceRoots] Called');
    console.log('[InitWorkspaceRoots] vscode.workspace.workspaceFolders:', vscode.workspace.workspaceFolders);
    
    // Build a new map first; swap atomically
    const newRoots = new Map<string, string>();
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        console.log(`[InitWorkspaceRoots] Adding root: ${folder.uri.toString()} -> ${folder.uri.fsPath}`);
        newRoots.set(folder.uri.toString(), folder.uri.fsPath);
      }
    }
    
    // Atomically replace the roots
    this.workspaceRoots = newRoots;
    console.log(`[InitWorkspaceRoots] Final workspace roots count: ${this.workspaceRoots.size}`);
    
    // Mark dirty and immediately build (coalesced)
    this.indexNeedsRebuild = true;
    await this.ensureIgnoreHelperReady(); // Ensure ignore rules loaded before building index
    await this.buildFlatFileIndex();
  }
  
  /**
   * Wait for the flat file index to be built - useful for tests
   */
  public async waitForIndexBuild(): Promise<void> {
    if (this.indexBuildPromise) {
      await this.indexBuildPromise;
    } else if (this.indexNeedsRebuild) {
      await this.buildFlatFileIndex();
    }
  }

  /**
   * Wait for all async operations to complete - test helper
   * Replaces arbitrary setTimeout calls in tests
   */
  public async waitIdle(): Promise<void> {
    if (this.indexBuildPromise) {
      try { await this.indexBuildPromise; } catch { /* ignore in tests */ }
    }
    if (this.pendingSearch) {
      try { await this.pendingSearch; } catch { /* ignore in tests */ }
    }
  }

  private async handleWorkspaceFoldersChanged(e: vscode.WorkspaceFoldersChangeEvent): Promise<void> {
    // Add new folders
    for (const folder of e.added) {
      this.workspaceRoots.set(folder.uri.toString(), folder.uri.fsPath);
      this.setupFileSystemWatcherForWorkspace(folder.uri.fsPath);
    }

    // Remove deleted folders and their files from selection
    for (const folder of e.removed) {
      const rootPath = this.workspaceRoots.get(folder.uri.toString());
      if (rootPath) {
        this.workspaceRoots.delete(folder.uri.toString());
        this.removeFilesFromSelection(rootPath);
      }
    }

    // Any root change invalidates ignore rules and the index
    this.invalidateIndex();
    await this.ensureIgnoreHelperReady(true);
    await this.buildFlatFileIndex();
    
    // Refresh view
    this.refresh();
  }

  private removeFilesFromSelection(rootPath: string): void {
    // Remove all selected files that start with this path
    for (const [path, checked] of checkedItems.entries()) {
      if (path.startsWith(rootPath)) {
        checkedItems.delete(path);
      }
    }
  }

  private setupFileSystemWatchers(): void {
    // Set up watchers for all workspace folders
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        this.setupFileSystemWatcherForWorkspace(folder.uri.fsPath);
      }
    }
  }

  private setupFileSystemWatcherForWorkspace(workspacePath: string): void {
    // Create a file system watcher for the workspace
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(workspacePath), '**/*')
    );

    // Add watchers to disposables
    this.disposables.push(
      fileWatcher,
      fileWatcher.onDidCreate((uri) => {
        const fileName = path.basename(uri.fsPath);
        if (fileName === '.gitignore' || fileName === '.promptcode_ignore') {
          this.refreshIgnoreHelper();
        } else {
          // Invalidate index on file creation
          this.invalidateIndex();
          this.refresh();
        }
      }),
      fileWatcher.onDidDelete((uri) => {
        const fileName = path.basename(uri.fsPath);
        if (fileName === '.gitignore' || fileName === '.promptcode_ignore') {
          this.refreshIgnoreHelper();
        } else {
          // Remove from index immediately on deletion
          this.flatFileIndex.delete(uri.fsPath);
          this.refresh();
        }
      }),
      fileWatcher.onDidChange((uri) => {
        const fileName = path.basename(uri.fsPath);
        if (fileName === '.gitignore' || fileName === '.promptcode_ignore') {
          this.refreshIgnoreHelper();
        } else {
          // Invalidate index on file changes
          this.invalidateIndex();
          this.refresh(); // Refresh on general file changes too
        }
      })
    );
  }

  // Method to dispose watchers when extension is deactivated
  dispose(): void {
    // Clean up search timer if it's active
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    
    // Clear the flat file index
    this.flatFileIndex.clear();
    
    // Dispose all other disposables
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }

  /**
   * Build or rebuild the flat file index for fast searches
   * This creates a Map of all files in the workspace for O(1) lookups
   */
  private async buildFlatFileIndex(): Promise<void> {
    // If already building, wait for it
    if (this.indexBuildPromise) {
      return this.indexBuildPromise;
    }
    
    // Start building
    this.indexBuildPromise = this._buildFlatFileIndex();
    
    try {
      await this.indexBuildPromise;
    } finally {
      this.indexBuildPromise = null;
    }
  }
  
  private async _buildFlatFileIndex(): Promise<void> {
    console.log('[FlatIndex] Building flat file index...');
    console.log(`[FlatIndex] Workspace roots count: ${this.workspaceRoots.size}`);
    
    // If we currently have no workspace roots, do not finalize an empty index
    if (this.workspaceRoots.size === 0) {
      console.warn('[FlatIndex] Skipping index build: no workspace roots. Will retry later.');
      // IMPORTANT: keep the index dirty so the next caller will try again
      this.indexNeedsRebuild = true;
      return;
    }
    
    const startTime = Date.now();
    
    // Clear existing index
    this.flatFileIndex.clear();
    
    // Recursively scan all workspace roots
    for (const [uriString, rootPath] of this.workspaceRoots) {
      console.log(`[FlatIndex] Scanning root: ${rootPath}`);
      await this.scanDirectoryForIndex(rootPath, rootPath);
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[FlatIndex] Index built: ${this.flatFileIndex.size} files in ${elapsed}ms`);
    
    // Rebuild directory aggregation after index is complete
    this.rebuildDirAggregation();
    
    // Only finalize as "clean" if we had roots at build time
    this.indexNeedsRebuild = false;
  }
  
  /**
   * Recursively scan a directory and add all files to the flat index
   */
  private async scanDirectoryForIndex(dirPath: string, workspaceRoot: string): Promise<void> {
    try {
      // Check if this path should be ignored
      const dirIgnored = this.ignoreHelper && this.ignoreHelper.shouldIgnore(dirPath, true); // It's a directory
      if (dirIgnored) {
        return;
      }
      
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        // Check if this entry should be ignored
        const entryIgnored = this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath, entry.isDirectory());
        if (entryIgnored) {
          continue;
        }
        
        // Add to index
        const relativePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
        this.flatFileIndex.set(fullPath, {
          path: fullPath,
          name: entry.name,
          isDirectory: entry.isDirectory(),
          relativePath: relativePath,
          workspaceRoot: workspaceRoot
        });
        
        // Recursively scan subdirectories
        if (entry.isDirectory()) {
          await this.scanDirectoryForIndex(fullPath, workspaceRoot);
        }
      }
    } catch (error) {
      console.error(`[FlatIndex] Error scanning directory ${dirPath}:`, error);
    }
  }
  
  /**
   * Mark the index as needing rebuild on file system changes
   */
  private invalidateIndex(): void {
    this.indexNeedsRebuild = true;
  }

  /**
   * Set the extension context for state persistence
   */
  setContext(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadExpandedState();
  }
  
  /**
   * Load expanded state from workspace storage
   */
  private loadExpandedState(): void {
    if (!this.context) {return;}
    
    const savedState = this.context.workspaceState.get<string[]>('promptcode.expandedItems', []);
    expandedItems.clear();
    savedState.forEach(path => expandedItems.set(path, true));
    console.log(`[State] Loaded ${expandedItems.size} expanded items from workspace state`);
  }
  
  /**
   * Save expanded state to workspace storage
   */
  private saveExpandedState(): void {
    if (!this.context) {return;}
    
    const paths = Array.from(expandedItems.keys());
    this.context.workspaceState.update('promptcode.expandedItems', paths);
    console.log(`[State] Saved ${paths.length} expanded items to workspace state`);
  }

  // Set the tree view instance
  setTreeView(treeView: vscode.TreeView<FileItem>) {
    this._treeView = treeView;

    // Add listeners for expand/collapse events to track expanded state
    this.disposables.push(
      treeView.onDidExpandElement(e => {
        expandedItems.set(e.element.fullPath, true);
        this.saveExpandedState();
      }),

      treeView.onDidCollapseElement(e => {
        expandedItems.set(e.element.fullPath, false);
        this.saveExpandedState();
      })
    );
  }

  refresh(): void {
    // Clear cache when refreshing
    this.cachedEntries.clear();
    this._onDidChangeTreeData.fire();
  }

  // Method to refresh the ignore helper
  async refreshIgnoreHelper(): Promise<void> {
    if (!this.ignoreHelper) {
      return;
    }
    
    try {
      await this.ignoreHelper.initialize();
      // After ignore patterns are reloaded, clean up any selected files that are now ignored
      this.cleanupSelectedFiles();
      this.refresh();
    } catch (error) {
      console.error('Error refreshing ignore helper:', error);
    }
  }

  // Remove ignored files from selection
  private cleanupSelectedFiles(): void {
    if (!this.ignoreHelper) {
      return;
    }

    // Create a list of items to remove
    const itemsToRemove: string[] = [];

    // Check each selected item (files and directories)
    for (const [itemPath, isChecked] of checkedItems.entries()) {
      if (isChecked && this.ignoreHelper.shouldIgnore(itemPath)) {
        itemsToRemove.push(itemPath);
      }
    }

    // Remove the items from selection
    for (const itemPath of itemsToRemove) {
      checkedItems.delete(itemPath);

      // Update parent states for this path
      this.updateParentStates(itemPath).catch(error => {
        console.error(`Error updating parent states for ${itemPath}:`, error);
      });

      const isDirectory = fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory();
      console.log(`Removed now-ignored ${isDirectory ? 'directory' : 'file'} from selection: ${itemPath}`);
    }

    // If any items were removed, notify the webview
    if (itemsToRemove.length > 0) {
      vscode.commands.executeCommand('promptcode.getSelectedFiles');
    }
  }

  // Set the search term and refresh the tree
  async setSearchTerm(searchTerm: string, globPattern?: boolean, shouldIncludeFolders?: boolean): Promise<void> {
    console.log(`FileExplorer: Setting search term to "${searchTerm}", glob: ${globPattern}, includeFolders: ${shouldIncludeFolders}`);

    const searchTermLower = (searchTerm || '').toLowerCase();
    const nextIsGlob = !!globPattern;
    const nextIncludeFolders = !!shouldIncludeFolders;

    // Detect changes BEFORE mutating instance state
    const togglesChanged = 
      nextIsGlob !== this.isGlobSearch ||
      nextIncludeFolders !== this.includeFoldersInSearch;

    // Now update state
    this.isGlobSearch = nextIsGlob;
    this.includeFoldersInSearch = nextIncludeFolders;

    // Only short-circuit if neither the term nor the toggles changed
    if (!togglesChanged && this.searchTerm === searchTermLower) {
      return;
    }
    this.searchTerm = searchTermLower;

    const sequence = ++this.searchSequence;
    
    // Clear existing timer
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    
    // Resolve the previous pending search if it exists
    if (this.pendingSearchResolver) {
      this.pendingSearchResolver();
      this.pendingSearchResolver = null;
    }

    // Create a new pending search promise
    this.pendingSearch = new Promise<void>((resolve) => {
      this.pendingSearchResolver = resolve;
      this.searchTimer = setTimeout(async () => {
        // IMPORTANT: clear the timer pointer so getCurrentSearchResults() can proceed
        this.searchTimer = null;

        try {
          // Ensure index is ready if needed
          if (this.indexNeedsRebuild) {
            await this.buildFlatFileIndex();
          }

          if (this.searchTerm.trim() !== '') {
            // When searching, first build the search paths
            await this.rebuildSearchPaths();
            
            // Check again if superseded after the expensive rebuild operation
            if (sequence !== this.searchSequence) {
              return;
            }

            // Then refresh the tree to show matching items
            this.refresh();

            // After refreshing, expand ancestors of matches
            // Use setImmediate when available (Node/Electron) or fall back to setTimeout
            const expectedSeq = sequence;
            const schedule = (cb: Function) => {
              if (typeof setImmediate === 'function') {
                setImmediate(cb);
              } else {
                setTimeout(cb, 0);
              }
            };
            
            schedule(() => {
              if (expectedSeq === this.searchSequence) {
                this.expandAncestorsOfMatches(expectedSeq).catch(error => {
                  console.error('Error expanding search matches:', error);
                });
              }
            });

            // Auto-select if only one direct file match (not including ancestors)
            if (this.lastDirectFileMatches.length === 1) {
              const singlePath = this.lastDirectFileMatches[0];
              try {
                const stats = fs.statSync(singlePath);
                if (stats.isFile()) {  // Only auto-select files, not directories
                  checkedItems.clear();
                  checkedItems.set(singlePath, vscode.TreeItemCheckboxState.Checked);
                  this.refresh();
                  vscode.commands.executeCommand('promptcode.getSelectedFiles');
                }
              } catch (error) {
                // File may have been deleted or inaccessible, skip auto-selection
                console.log(`Could not auto-select ${singlePath}: ${error}`);
              }
            }
          } else {
            // Clear the included paths when search is cleared for better performance
            this.includedPaths.clear();

            // Full refresh when clearing search
            this.refresh();
          }
        } finally {
          if (sequence === this.searchSequence) {
            this.pendingSearch = null;
            this.pendingSearchResolver = null;
          }
          resolve();
        }
      }, 200); // debounce interval
    });

    // IMPORTANT: do not await the debounced work here.
    // Returning immediately lets rapid calls coalesce into one run,
    // which is the expected UI behavior and matches the test.
    return;
  }

  // --- ADDED: Simple Glob to Regex Converter ---
  /**
   * Converts a simple glob pattern (*, ?) into a case-insensitive RegExp.
   * Returns null if the pattern is empty or doesn't contain glob characters.
   */
  private globToRegex(pattern: string): RegExp | null {
    if (!pattern || !pattern.trim()) {
      return null; // Empty pattern
    }

    // Check if it's actually a glob pattern
    if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('{')) {
      return null; // Not a glob pattern
    }

    // Normalize path separators to forward slashes
    pattern = pattern.replace(/\\/g, '/');

    // Escape characters with special meaning in regex (except *, ?, /, {})
    let escapedPattern = pattern.replace(/[.+^$()|[\]\\]/g, '\\$&');
    
    // Brace expansion: "*.{ts,tsx}" -> "*.(ts|tsx)"
    escapedPattern = escapedPattern.replace(/\{([^}]+)\}/g, (_m, inner) => {
      const alts = String(inner).split(',').map(s => s.trim().replace(/[.+^$()|[\]\\]/g, '\\$&'));
      return `(${alts.join('|')})`;
    }); 

    // Convert glob patterns to regex:
    // ** matches any number of directories (including zero)
    // * matches any characters except path separator
    // ? matches single character except path separator
    let regexString = escapedPattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')  // Temporarily mark ** patterns
      .replace(/\*/g, '[^/]*')           // * matches anything except /
      .replace(/\?/g, '[^/]')             // ? matches single char except /
      .replace(/\/{{GLOBSTAR}}\//g, '(?:/.*)?/') // /**/ matches zero or more path segments
      .replace(/{{GLOBSTAR}}/g, '.*');   // ** at other positions matches anything

    try {
      // Create case-insensitive regex (anchored to match the whole path)
      // The 'i' flag makes it case-insensitive
      return new RegExp(`^${regexString}$`, 'i');
    } catch (e) {
      console.error(`Invalid regex generated from glob pattern: ${pattern}`, e);
      return null; // Invalid pattern results in invalid regex
    }
  }
  // --- END ADDED ---

  // First stage of search: find all matches and build path inclusion set
  private async rebuildSearchPaths(): Promise<void> {
    console.log(`[Debug] rebuildSearchPaths START (Flat Index) for term: "${this.searchTerm}"`);
    this.includedPaths.clear(); // Clear the final set
    this.lastDirectFileMatches = []; // Clear direct file matches for auto-select
    const directMatches = new Set<string>(); // Set for Pass 1 results

    if (!this.searchTerm.trim()) {
      console.log(`[Debug] rebuildSearchPaths: Search term is empty. No filtering needed.`);
      // No need to refresh here, getChildren will handle showing everything
      return;
    }

    // Build index if needed
    if (this.indexNeedsRebuild) {
      await this.buildFlatFileIndex();
    }

    const normalizedSearchTerm = this.searchTerm.trim().toLowerCase();
    const isPathSearch = normalizedSearchTerm.includes('/') || normalizedSearchTerm.includes('\\');
    
    // Create glob regex - use the same regex for both path and filename matching
    const globRegex = this.isGlobSearch ? this.globToRegex(this.searchTerm.trim()) : null;
    
    console.log(`[Debug] rebuildSearchPaths: Normalized term: "${normalizedSearchTerm}", Is path search: ${isPathSearch}, Is glob: ${this.isGlobSearch}, Include folders: ${this.includeFoldersInSearch}`);
    console.log(`[FlatIndex] Using flat index with ${this.flatFileIndex.size} entries`);
    
    // Performance optimization: Only do deep scan for complex cases
    const doDeepScan = this.isGlobSearch || isPathSearch || this.includeFoldersInSearch;
    
    // For simple substring searches on filenames only, use lightweight scan
    if (!doDeepScan) {
      console.log(`[Debug] rebuildSearchPaths: Using lightweight filtering for simple filename search`);
      // Populate directMatches with:
      //  (1) filename substring matches
      //  (2) directory *segment* matches in the normalized relative path
      for (const [fullPath, fileInfo] of this.flatFileIndex) {
        const nameLower = fileInfo.name.toLowerCase();
        if (nameLower.includes(normalizedSearchTerm)) {
          directMatches.add(fullPath);
          continue;
        }

        // Segment-aware path check: ".../deep/..." or segment at path ends
        const relLower = fileInfo.relativePath.toLowerCase().replace(/\\/g, '/');
        const seg = `/${normalizedSearchTerm}`;
        const isSegMatch =
          relLower.includes(`${seg}/`) || // middle segment
          relLower.endsWith(seg) ||       // trailing segment
          relLower.startsWith(`${normalizedSearchTerm}/`); // leading segment
        if (isSegMatch) {directMatches.add(fullPath);}
      }
      console.log(`[FlatIndex] Lightweight search completed - found ${directMatches.size} matches`);
      // Don't return early - we still need to run Pass 2 for auto-expand to work
    } else {
      // --- PASS 1: Find Direct Matches using Flat Index ---
      console.log("[Debug] rebuildSearchPaths: Starting Pass 1 (Using flat index)");
      
      // Iterate through the flat index for deep scan
      for (const [fullPath, fileInfo] of this.flatFileIndex) {
        // Match logic
        const entryNameLower = fileInfo.name.toLowerCase();
        let isMatch = false;
        
        if (isPathSearch) {
          // For path searches, check the relative path
          const relativePathLower = fileInfo.relativePath.toLowerCase();
          
          if (globRegex) {
            // Apply glob pattern to the normalized relative path
            const normalizedPath = fileInfo.relativePath.replace(/\\/g, '/');
            isMatch = globRegex.test(normalizedPath);
          } else {
            // Fallback to substring match for non-glob path searches
            isMatch = relativePathLower.includes(normalizedSearchTerm.replace(/\\/g, '/'));
          }
        } else if (this.isGlobSearch) {
          // For filename glob patterns, test against the file name
          isMatch = globRegex ? globRegex.test(fileInfo.name) : false;
        } else {
          // For simple searches, check if name contains the search term
          isMatch = entryNameLower.includes(normalizedSearchTerm);
        }

        // Handle include folders option - skip directories if not included
        if (isMatch && fileInfo.isDirectory && !this.includeFoldersInSearch) {
          isMatch = false;
        }
        
        if (isMatch) {
          directMatches.add(fullPath);
        }
      }
    
    console.log(`[FlatIndex] Pass 1 completed - found ${directMatches.size} matches from ${this.flatFileIndex.size} total entries`);
    } // End of else block for deep scan

    // Print sorted direct matches
    const sortedDirectMatches = Array.from(directMatches).sort();
    console.log(`[Debug] rebuildSearchPaths: Pass 1 Results (Direct Matches):`, sortedDirectMatches);

    // If no direct matches found, no need for Pass 2
    if (directMatches.size === 0) {
        console.log("[Debug] rebuildSearchPaths: No direct matches found, skipping Pass 2.");
        // includedPaths remains empty, so refresh will show nothing
        return;
    }
    
    // Track direct file matches (not directories) for single-result auto-select
    // This must be done BEFORE Pass 2 adds ancestors
    for (const matchPath of directMatches) {
      const fileInfo = this.flatFileIndex.get(matchPath);
      if (fileInfo && !fileInfo.isDirectory) {
        this.lastDirectFileMatches.push(matchPath);
      }
    }

    // --- PASS 2: Add Ancestors and Descendants --- 
    console.log("[Debug] rebuildSearchPaths: Starting Pass 2 (Adding ancestors and descendants)");
    // Initialize final set with direct matches
    this.includedPaths = new Set(directMatches);

    // Helper function to add all descendants using flat index
    const addDescendantsFromIndex = (dirPath: string): void => {
      const dirPathNormalized = dirPath.replace(/\\/g, '/');
      
      // Use flat index to find all descendants efficiently
      for (const [fullPath, fileInfo] of this.flatFileIndex) {
        // Check if this path is a descendant of dirPath
        const fullPathNormalized = fullPath.replace(/\\/g, '/');
        if (fullPathNormalized.startsWith(dirPathNormalized + '/')) {
          this.includedPaths.add(fullPath);
        }
      }
    };

    // Process each direct match for Pass 2
    for (const matchPath of directMatches) {
      // 2a: Add Ancestors
      let currentPath = matchPath;
      while (currentPath !== path.dirname(currentPath)) { // Loop up towards the root
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {break;} // Stop at filesystem root

        this.includedPaths.add(parentPath); // Add ancestor

        // Stop if we hit a workspace root
        const isWorkspaceRoot = Array.from(this.workspaceRoots.values()).some(root => parentPath === root);
        if (isWorkspaceRoot) {
          break;
        }
        currentPath = parentPath;
      }

      // 2b: Add Descendants (if it's a directory)
      try {
        const stats = await fs.promises.stat(matchPath);
        if (stats.isDirectory()) {
          addDescendantsFromIndex(matchPath);
        }
      } catch (error) {
        // Ignore errors if item was deleted between passes
         if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
             console.error(`Error stating direct match ${matchPath} for descendant check:`, error);
         }
      }
    }

    console.log(`[Debug] rebuildSearchPaths: Pass 2 Complete. Final includedPaths size: ${this.includedPaths.size}`);
    // console.log(`[Debug] rebuildSearchPaths: Final includedPaths:`, Array.from(this.includedPaths).sort()); // Optional: Log full final set
  }

  // Check if an item should be included in search results based on the inclusion set
  private shouldIncludeInSearch(fullPath: string, isDirectory: boolean): boolean {
    // If no search term is active, include everything
    if (!this.searchTerm.trim()) {
      return true;
    }
    
    // For lightweight searches (simple filename substring), do on-the-fly filtering
    const isPathSearch = this.searchTerm.includes('/') || this.searchTerm.includes('\\');
    const doDeepScan = this.isGlobSearch || isPathSearch || this.includeFoldersInSearch;
    
    if (!doDeepScan && this.includedPaths.size === 0) {
      // Lightweight mode: just check filename
      const filename = path.basename(fullPath).toLowerCase();
      const searchTermLower = this.searchTerm.toLowerCase();
      const matches = filename.includes(searchTermLower);
      
      // For directories in lightweight mode, always include them to allow navigation
      if (isDirectory) {
        return true;
      }
      
      return matches;
    }

    // Otherwise, include only if the path exists in the final includedPaths set
    const include = this.includedPaths.has(fullPath);
    console.log(`[Debug] shouldIncludeInSearch: Checking "${fullPath}". Included: ${include}`); // Simplified log
    return include;
  }

  // Get the current search term
  getSearchTerm(): string {
    return this.searchTerm;
  }

  getTreeItem(element: FileItem): vscode.TreeItem {
    return element;
  }

  // Implement getParent method required for reveal to work
  async getParent(element: FileItem): Promise<FileItem | null> {
    if (!element || !element.fullPath || !this.workspaceRoots.size) {
      return null;
    }

    // Check if this is a workspace root
    for (const rootPath of this.workspaceRoots.values()) {
      if (element.fullPath === rootPath) {
        return null; // Workspace roots have no parent
      }
    }

    // Get the parent directory path
    const parentPath = path.dirname(element.fullPath);

    // Check if the parent is a workspace root
    for (const [uriString, rootPath] of this.workspaceRoots.entries()) {
      if (parentPath === rootPath) {
        const uri = vscode.Uri.parse(uriString);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const displayName = workspaceFolder ? workspaceFolder.name : path.basename(rootPath);

        return new FileItem(
          uri,
          vscode.TreeItemCollapsibleState.Collapsed,
          true,
          rootPath,
          displayName
        );
      }
    }

    // Regular directory parent
    try {
        await fs.promises.access(parentPath); // Ensure parent exists
        const uri = vscode.Uri.file(parentPath);
        return new FileItem(
            uri,
            vscode.TreeItemCollapsibleState.Collapsed,
            true,
            parentPath
        );
     } catch {
        return null; // Parent does not exist or is not accessible
     }

  }

  async getChildren(element?: FileItem): Promise<FileItem[]> {
    if (!this.workspaceRoots.size) {
        // Use a dedicated command or status bar message instead of showInformationMessage
        vscode.commands.executeCommand('setContext', 'promptcode.noWorkspace', true);
        // Optionally, show a welcome message in the view itself
        // If using Welcome View API: return Promise.resolve([]);
        // If customizing view message: Need TreeView.message property (might require API update)
        return Promise.resolve([]);
    } else {
        vscode.commands.executeCommand('setContext', 'promptcode.noWorkspace', false);
    }


    // If element is provided, get its children (standard folder contents)
    if (element) {
      const directoryPath = element.fullPath;

      if (!fs.existsSync(directoryPath)) {
        return Promise.resolve([]);
      }

      // Use cached entries if available
      const cached = this.cachedEntries.get(directoryPath);
      if (cached) {
        return this.processDirectoryEntries(directoryPath, cached);
      }

      // Read directory contents
      try {
        const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
        this.cachedEntries.set(directoryPath, entries);
        return this.processDirectoryEntries(directoryPath, entries);
      } catch (error) {
        // Handle common errors gracefully
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EACCES') {
            console.warn(`Permission denied reading directory ${directoryPath}`);
        } else if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.warn(`Directory not found ${directoryPath}`);
        } else {
            console.error(`Error reading directory ${directoryPath}:`, error);
        }
        return Promise.resolve([]);
      }
    } else {
      // Top level - return all workspace roots
      const rootItems: FileItem[] = [];

      for (const [uriString, fsPath] of this.workspaceRoots.entries()) {
        const uri = vscode.Uri.parse(uriString);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const displayName = workspaceFolder ? workspaceFolder.name : path.basename(fsPath);

        // Create a FileItem for each workspace root
        const rootItem = new FileItem(
          uri,
          expandedItems.get(fsPath) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
          true,
          fsPath,
          displayName
        );

        rootItems.push(rootItem);
      }

      return rootItems;
    }
  }

  // Create a FileItem from a Dirent
  private createFileItem(
    entry: fs.Dirent,
    directoryPath: string,
    collapsibleState?: vscode.TreeItemCollapsibleState
  ): FileItem {
    const fullPath = path.join(directoryPath, entry.name);
    const resourceUri = vscode.Uri.file(fullPath);
    const isDirectory = entry.isDirectory();

    // Check if this item should be expanded based on expandedItems map
    let state: vscode.TreeItemCollapsibleState;
    if (collapsibleState !== undefined) {
      state = collapsibleState;
    } else if (isDirectory) {
      // If it's in the expandedItems map and set to true, expand it
      state = expandedItems.get(fullPath)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      state = vscode.TreeItemCollapsibleState.None;
    }

    return new FileItem(
      resourceUri,
      state,
      isDirectory,
      fullPath
    );
  }

  /**
   * Check if a directory is effectively empty after applying ignore patterns
   * A directory is effectively empty if it contains no files or if all its contents
   * (including subdirectories' contents) are ignored
   */
  private async isDirectoryEffectivelyEmpty(dirPath: string): Promise<boolean> {
    try {
      // Get all entries in this directory
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      // If no entries at all, it's definitely empty
      if (entries.length === 0) {
        return true;
      }

      // Filter entries using ignore patterns
      const visibleEntries = this.ignoreHelper
        ? entries.filter(entry => {
            const fullPath = path.join(dirPath, entry.name);
            return !this.ignoreHelper!.shouldIgnore(fullPath, entry.isDirectory());
          })
        : entries.filter(entry =>
            entry.name !== 'node_modules' &&
            entry.name !== '.git'
          );

      // If no visible entries after filtering, it's effectively empty
      if (visibleEntries.length === 0) {
        return true;
      }

      // Check if there are any visible files (not directories)
      const visibleFiles = visibleEntries.filter(entry => !entry.isDirectory());
      if (visibleFiles.length > 0) {
        // Has at least one visible file, so not empty
        return false;
      }

      // If we get here, we only have directories
      // Check each subdirectory recursively
      for (const entry of visibleEntries) {
        if (entry.isDirectory()) {
          const subDirPath = path.join(dirPath, entry.name);
          const subDirEmpty = await this.isDirectoryEffectivelyEmpty(subDirPath);

          // If any subdirectory is not empty, then this directory is not empty
          if (!subDirEmpty) {
            return false;
          }
        }
      }

      // If all subdirectories are empty or ignored, this directory is effectively empty
      return true;
    } catch (error) {
      // Handle errors like permission denied
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'EACCES') {
            console.error(`Error checking if directory ${dirPath} is empty:`, error);
        }
        // In case of error, assume not empty to be safe
        return false;
    }
  }

  private async processDirectoryEntries(directoryPath: string, entries: fs.Dirent[]): Promise<FileItem[]> {
    // Filter entries using ignore helper
    let filteredEntries = entries;

    if (this.ignoreHelper) {
      filteredEntries = entries.filter(entry => {
        const fullPath = path.join(directoryPath, entry.name);
        return !this.ignoreHelper!.shouldIgnore(fullPath, entry.isDirectory());
      });
    } else {
      // Fall back to basic filtering if the ignore helper is not available
      filteredEntries = entries.filter(entry =>
        entry.name !== 'node_modules' &&
        entry.name !== '.git'
      );
    }

    // Filter empty directories
    if (filteredEntries.some(entry => entry.isDirectory())) {
      const directories = filteredEntries.filter(entry => entry.isDirectory());

      const nonEmptyDirPromises = directories.map(async dir => {
        const fullPath = path.join(directoryPath, dir.name);
        const isEmpty = await this.isDirectoryEffectivelyEmpty(fullPath);
        return { dir, isEmpty };
      });

      const dirResults = await Promise.all(nonEmptyDirPromises);
      const nonEmptyDirs = dirResults
        .filter(result => !result.isEmpty)
        .map(result => result.dir);

      const nonDirEntries = filteredEntries.filter(entry => !entry.isDirectory());
      filteredEntries = [...nonEmptyDirs, ...nonDirEntries];
    }

    // Apply search filtering
    if (this.searchTerm.trim()) {
      // Check if we should include this directory's children based on the inclusion set
      const matchingEntries = filteredEntries.filter(entry => {
          const fullPath = path.join(directoryPath, entry.name);
          const include = this.shouldIncludeInSearch(fullPath, entry.isDirectory());
          return include;
      });

      return matchingEntries.map(entry => {
        const fullPath = path.join(directoryPath, entry.name);
        const fileItem = this.createFileItem(
          entry,
          directoryPath,
          // Force collapsed state during search initially for performance, expansion happens later
          entry.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        // Ensure checkbox state is preserved
        if (checkedItems.has(fullPath)) {
          fileItem.checkboxState = checkedItems.get(fullPath) ?? vscode.TreeItemCheckboxState.Unchecked;
        }

        return fileItem;
      });
    }


    // No search term, return all filtered entries
    return filteredEntries.map(entry => {
      const fullPath = path.join(directoryPath, entry.name);
      const fileItem = this.createFileItem(
        entry,
        directoryPath,
        entry.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
      );

      // Ensure checkbox state is preserved
      if (checkedItems.has(fullPath)) {
        fileItem.checkboxState = checkedItems.get(fullPath) ?? vscode.TreeItemCheckboxState.Unchecked;
      }

      return fileItem;
    });
  }

  // Handle checkbox state changes
  handleCheckboxToggle(item: FileItem, state: vscode.TreeItemCheckboxState): void {
    // Ignore no-ops – saves queue slots
    if (checkedItems.get(item.fullPath) === state) { return; }

    this.checkboxQueue = this.checkboxQueue
      .then(() => vscode.window.withProgress({
          cancellable: false,
          location: vscode.ProgressLocation.Window,
          title: 'Updating selection…'
        }, async () => {
          try {
            await this.processCheckboxChange(item, state);
            this.refresh();
            await vscode.commands.executeCommand('promptcode.getSelectedFiles');
          } catch (error) {
            // Propagate error to be caught by outer catch
            console.error('Error processing checkbox change:', error);
            vscode.window.showErrorMessage(`Failed to update selection: ${error}`);
            throw error;
          }
        }))
      .catch(err => {
        console.error('Checkbox queue error:', err);
        this.refresh(); // Still refresh on error to potentially clear bad state
        // Return resolved promise to keep queue going
        return Promise.resolve();
      });
  }

  // Process checkbox changes synchronously to avoid race conditions
  private async processCheckboxChange(item: FileItem, state: vscode.TreeItemCheckboxState): Promise<void> {
    // Step 1: Update the current item's state
    const wasChecked = checkedItems.get(item.fullPath) === vscode.TreeItemCheckboxState.Checked;
    const isNowChecked = state === vscode.TreeItemCheckboxState.Checked;
    checkedItems.set(item.fullPath, state);
    
    // Update aggregation for single file change
    if (!item.isDirectory) {
      const delta = isNowChecked ? 1 : (wasChecked ? -1 : 0);
      if (delta !== 0) {
        this.updateDirAggregation(item.fullPath, delta, true);
      }
    }

    // Step 2: If it's a directory, update all children
    if (item.isDirectory) {
      await this.setAllChildrenState(item.fullPath, isNowChecked);
    }

    // Step 3: Update all parent directories up to the root
    await this.updateParentChain(path.dirname(item.fullPath));
    
    // Step 4: Update file decorations for tri-state visual indication
    this.updateDecorations([item.fullPath]);
  }

  // Set checkbox state for all children (simplifying previous methods)
  private async setAllChildrenState(dirPath: string, isChecked: boolean): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const state = isChecked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip ignored items
        if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath, entry.isDirectory())) {
          continue;
        }

        // Track previous state for aggregation update
        const wasChecked = checkedItems.get(fullPath) === vscode.TreeItemCheckboxState.Checked;
        
        // Set the state
        checkedItems.set(fullPath, state);
        
        // Update aggregation for file state changes
        if (entry.isFile()) {
          const delta = isChecked ? (wasChecked ? 0 : 1) : (wasChecked ? -1 : 0);
          if (delta !== 0) {
            this.updateDirAggregation(fullPath, delta, true);
          }
        }

        // Recursively process subdirectories
        if (entry.isDirectory()) {
          await this.setAllChildrenState(fullPath, isChecked);
        }
      }
    } catch (error) {
      // Ignore errors like permission denied
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'EACCES') {
           console.error(`Error setting children state for ${dirPath}:`, error);
        }
    }
  }

  // Update the entire chain of parent directories
  private async updateParentChain(dirPath: string | undefined): Promise<void> {
    // Stop if no valid directory path or no workspace roots
    if (!dirPath || dirPath === '' || !this.workspaceRoots.size || dirPath === path.dirname(dirPath)) {
        return;
    }

    try {
      // Check if dirPath is a workspace root itself
      let isWorkspaceRoot = false;
      for(const root of this.workspaceRoots.values()) {
          if(dirPath === root) {
              isWorkspaceRoot = true;
              break;
          }
      }

      // Get child states for this directory
      const childStates = await this.getChildrenStates(dirPath);

      // Determine parent state based on children
      if (childStates.length === 0) {
          // No visible children - preserve existing state if it was explicitly set
          // Only set to unchecked if it wasn't previously in the map
          if (!checkedItems.has(dirPath)) {
            checkedItems.set(dirPath, vscode.TreeItemCheckboxState.Unchecked);
          }
          // Otherwise keep the existing state (user may have explicitly checked an empty dir)
      } else {
        const allChecked = childStates.every(state => state === vscode.TreeItemCheckboxState.Checked);
        const allUnchecked = childStates.every(state => state === vscode.TreeItemCheckboxState.Unchecked);
        
        if (allChecked) {
          // All children checked -> parent checked
          checkedItems.set(dirPath, vscode.TreeItemCheckboxState.Checked);
        } else if (allUnchecked) {
          // All children unchecked -> parent unchecked
          checkedItems.set(dirPath, vscode.TreeItemCheckboxState.Unchecked);
        } else {
          // Mixed state -> parent is unchecked (VS Code doesn't have a Mixed state)
          checkedItems.set(dirPath, vscode.TreeItemCheckboxState.Unchecked);
        }
      }

      // Continue up the chain if not a workspace root
      if(!isWorkspaceRoot) {
           const parentDir = path.dirname(dirPath);
           if (parentDir && parentDir !== dirPath) {
             await this.updateParentChain(parentDir);
           }
      }

    } catch (error) {
      console.error(`Error updating parent chain for ${dirPath}:`, error);
    }
  }

  // Get the state of all visible children in a directory
  private async getChildrenStates(dirPath: string): Promise<vscode.TreeItemCheckboxState[]> {
    // Return empty array if path is empty
    if (!dirPath || dirPath === '') {
      console.warn('Empty directory path passed to getChildrenStates');
      return [];
    }

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const states: vscode.TreeItemCheckboxState[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip ignored items
        if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath, entry.isDirectory())) {
          continue;
        }

        // For directories, check if any descendants are selected
        if (entry.isDirectory()) {
          const directoryState = await this.getDirectoryState(fullPath);
          states.push(directoryState);
        } else {
          // For files, get the direct state
          const state = checkedItems.get(fullPath) ?? vscode.TreeItemCheckboxState.Unchecked;
          states.push(state);
        }
      }

      return states;
    } catch (error) {
     // Ignore errors like permission denied
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'EACCES') {
             console.error(`Error getting children states for ${dirPath}:`, error);
        }
      return [];
    }
  }

  // Get the checkbox state for a directory based on all its descendants
  private async getDirectoryState(dirPath: string): Promise<vscode.TreeItemCheckboxState> {
    // First check if the directory itself has an explicit state
    const explicitState = checkedItems.get(dirPath);
    
    // Check if any descendant (at any depth) is selected
    let hasCheckedDescendant = false;
    let hasUncheckedDescendant = false;
    
    // Check all items in checkedItems to see if they are descendants
    for (const [itemPath, state] of checkedItems.entries()) {
      // Check if itemPath is a descendant of dirPath
      if (itemPath.startsWith(dirPath + path.sep)) {
        if (state === vscode.TreeItemCheckboxState.Checked) {
          hasCheckedDescendant = true;
        } else if (state === vscode.TreeItemCheckboxState.Unchecked) {
          hasUncheckedDescendant = true;
        }
        
        // If we found both, it's mixed (return Unchecked to indicate partial selection)
        if (hasCheckedDescendant && hasUncheckedDescendant) {
          return vscode.TreeItemCheckboxState.Unchecked; // VS Code doesn't have a Mixed state
        }
      }
    }
    
    // If we have an explicit state and no descendants, use it
    if (explicitState !== undefined && !hasCheckedDescendant && !hasUncheckedDescendant) {
      return explicitState;
    }
    
    // Determine state based on descendants
    if (hasCheckedDescendant && !hasUncheckedDescendant) {
      return vscode.TreeItemCheckboxState.Checked;
    } else if (!hasCheckedDescendant && hasUncheckedDescendant) {
      return vscode.TreeItemCheckboxState.Unchecked;
    } else if (hasCheckedDescendant && hasUncheckedDescendant) {
      return vscode.TreeItemCheckboxState.Unchecked; // VS Code doesn't have a Mixed state
    }
    
    // No descendants found, return explicit state or unchecked
    return explicitState ?? vscode.TreeItemCheckboxState.Unchecked;
  }

  // Public method to update parent directory checkbox states when a file is unchecked
  public async updateParentStates(filePath: string): Promise<void> {
    // Get the parent directory path
    const parentDir = path.dirname(filePath);

    // Update all parent directories up to the root
    await this.updateParentChain(parentDir);
  }

  // Clear expanded state (to be used before expandAll)
  clearExpandedState(): void {
    expandedItems.clear();
  }

  // Select all files
  selectAll(): void {
    this.toggleAll(true);
  }

  // Deselect all files
  deselectAll(): void {
    this.toggleAll(false);
  }

  // Expand all directories
  async expandAll(): Promise<void> {
    console.log('expandAll method called in FileExplorerProvider');

    if (!this.workspaceRoots.size) {
      console.error('No workspace roots defined');
      return;
    }

    if (!this._treeView) {
      console.error('Tree view is not initialized');
      vscode.window.showErrorMessage('Tree view is not properly initialized.');
      return;
    }

    try {
      // Get the collection of all directories in the workspace
      const directories = await this.getAllDirectories();
      console.log(`Found ${directories.length} directories to expand`);

      // Limit to max directories to prevent performance issues
      const maxDirectories = 100; // Increased limit slightly

      // Limit directories to process if needed
      const directoriesToProcess = directories.length > maxDirectories
        ? directories.slice(0, maxDirectories)
        : directories;

      if (directories.length > maxDirectories) {
        vscode.window.showWarningMessage(`Expanding first ${maxDirectories} directories due to large workspace size.`);
        console.log(`Limited expansion to ${maxDirectories} directories (out of ${directories.length})`);
      }

      // Helper function to add delay
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Reveal directories level by level or in batches
      const revealBatch = async (batch: FileItem[]) => {
          for (const dir of batch) {
              expandedItems.set(dir.fullPath, true); // Mark as expanded first
          }
          // Reveal the batch
           await Promise.all(batch.map(dir =>
                this._treeView!.reveal(dir, { expand: true, select: false }).then(
                    () => {}, // Success handler (optional log)
                    (err) => console.warn(`Could not reveal ${dir.fullPath}: ${err.message}`) // Error handler
                )
            ));
           // No need to refresh here, reveal should update the view
      };

      const batchSize = 50; // Process 50 directories at a time
       for (let i = 0; i < directoriesToProcess.length; i += batchSize) {
            const batch = directoriesToProcess.slice(i, i + batchSize);
            console.log(`Expanding batch ${i / batchSize + 1}...`);
            await revealBatch(batch);
            await delay(100); // Small delay between batches
       }


      console.log('Expand all process completed.');
    } catch (error) {
      console.error('Error expanding directories:', error);
      // Still throw to maintain compatibility with callers expecting exceptions
      throw error;
    }
  }

  // Collapse all directories
  async collapseAll(): Promise<void> {
    console.log('collapseAll method called in FileExplorerProvider');

    if (!this._treeView) {
      console.error('Tree view is not initialized');
      vscode.window.showErrorMessage('Tree view is not properly initialized.');
      return;
    }

    try {
      // Use VS Code's built-in command to collapse all
      await vscode.commands.executeCommand('workbench.actions.treeView.promptcodeExplorer.collapseAll');

      // Clear expanded items map - do this after the collapse for next tree refresh
      expandedItems.clear();

      console.log('All directories collapsed.');
    } catch (error) {
      console.error('Error collapsing directories:', error);
      throw error;
    }
  }

  // Get all directories in the workspace
  private async getAllDirectories(): Promise<FileItem[]> {
    const directories: FileItem[] = [];

    // Function to recursively collect directories
    const collectDirectories = async (parentItem?: FileItem) => {
      const items = await this.getChildren(parentItem);

      // Process directories (non-empty directories will already be filtered in getChildren)
      for (const item of items) {
        if (item.isDirectory) {
          directories.push(item);
          await collectDirectories(item);
        }
      }
    };

    // Start the recursion from the root(s)
     for (const [uriString, fsPath] of this.workspaceRoots.entries()) {
        const uri = vscode.Uri.parse(uriString);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const displayName = workspaceFolder ? workspaceFolder.name : path.basename(fsPath);
        const rootItem = new FileItem(uri, vscode.TreeItemCollapsibleState.Collapsed, true, fsPath, displayName);
        directories.push(rootItem); // Add root itself
        await collectDirectories(rootItem);
    }


    // Sort directories by depth (shallowest first)
    directories.sort((a, b) => {
      const depthA = a.fullPath.split(path.sep).length;
      const depthB = b.fullPath.split(path.sep).length;
      return depthA - depthB;
    });

    return directories;
  }

  // Helper method to toggle all items
  private async toggleAll(checked: boolean): Promise<void> {
    if (!this.workspaceRoots.size) {
      return;
    }

    const state = checked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;

    // Recursive function to process directories
    const processDirectory = async (dirPath: string): Promise<void> => {
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          // Skip ignored files
          if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath)) {
            continue;
          }

          checkedItems.set(fullPath, state);

          if (entry.isDirectory()) {
            await processDirectory(fullPath);
          }
        }
      } catch (error) {
        // Ignore errors like permission denied
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'EACCES') {
            console.error(`Error processing directory ${dirPath}:`, error);
        }
      }
    };

    // Process each workspace root
    for (const rootPath of this.workspaceRoots.values()) {
      // Add the root directory itself to checkedItems
      checkedItems.set(rootPath, state);
      await processDirectory(rootPath);
    }

    this.refresh();

    // Notify the webview about the change in selected files
    vscode.commands.executeCommand('promptcode.getSelectedFiles');
  }

  // New optimized expander - only expands ancestors of matches, not entire tree
  private async expandAncestorsOfMatches(expectedSeq: number): Promise<void> {
    if (!this._treeView) {return;}
    
    console.log('Expanding ancestors of search matches');
    
    // Fast path: avoid touching disk; use index info
    const dirsToExpand = new Set<string>();
    const roots = new Set(this.workspaceRoots.values());

    for (const p of this.includedPaths) {
      const isDir = this.flatFileIndex.get(p)?.isDirectory ?? false;
      let cur = isDir ? p : path.dirname(p);
      while (cur && cur !== path.dirname(cur)) {
        dirsToExpand.add(cur);
        if (roots.has(cur)) {break;}
        cur = path.dirname(cur);
      }
    }

    console.log(`Will expand ${dirsToExpand.size} ancestor directories`);

    // Guard by sequence during the expansion loop
    const batch: FileItem[] = [];
    for (const dir of dirsToExpand) {
      if (expectedSeq !== this.searchSequence) {
        console.log('Expansion cancelled by newer search');
        return; // canceled by a newer search
      }
      expandedItems.set(dir, true);
      const fileItem = new FileItem(vscode.Uri.file(dir), vscode.TreeItemCollapsibleState.Collapsed, true, dir);
      batch.push(fileItem);
      
      if (batch.length >= 50) {
        await Promise.all(batch.map(item =>
          this._treeView!.reveal(item, { expand: true, select: false })
            .catch(() => {}) // Ignore reveal errors (directory might not be visible)
        ));
        batch.length = 0;
        await new Promise(r => setTimeout(r, 20));
      }
    }
    
    // Process remaining batch
    if (batch.length > 0) {
      await Promise.all(batch.map(item =>
        this._treeView!.reveal(item, { expand: true, select: false })
          .catch(() => {})
      ));
    }
    
    console.log('Expansion for search matches completed.');
  }
  
  // Deprecated - will be removed after migration
  private async expandMatchingDirectories(): Promise<void> {
    // This method is no longer used - replaced by expandAncestorsOfMatches
    console.warn('expandMatchingDirectories is deprecated, use expandAncestorsOfMatches');
  }

  // --- ADDED: Public method to check if a path should be ignored ---
  public shouldIgnore(filePath: string): boolean {
    return this.ignoreHelper ? this.ignoreHelper.shouldIgnore(filePath) : false;
  }
  // --- END ADDED ---

  // --- RESTORED: Get the ignore helper for external use ---
  public getIgnoreHelper(): IgnoreHelper | undefined {
    return this.ignoreHelper;
  }
  // --- END RESTORED ---

  /**
   * Get current search results (files only, no directories)
   * Used for revealing search matches on Enter key
   */
  public async getCurrentSearchResults(): Promise<string[]> {
    // If a debounced search is pending, await it
    if (this.pendingSearch) {
      await this.pendingSearch;
    }

    // Deep scan path: use includedPaths (already populated by rebuildSearchPaths)
    if (this.includedPaths.size > 0) {
      // Deterministic order for tests: sort by path
      return Array.from(this.includedPaths).filter(p => {
        try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
      }).sort();
    }

    // Lightweight filename/path search: compute from flat index
    if (!this.searchTerm || !this.searchTerm.trim()) {return [];}

    // Ensure index is available (in case tests call this directly)
    if (this.indexNeedsRebuild) {
      await this.buildFlatFileIndex();
    }

    const term = this.searchTerm.toLowerCase();
    const isPathy = term.includes('/') || term.includes('\\');

    // Optional: reuse glob regex if isGlobSearch.
    const glob = this.isGlobSearch ? this.globToRegex(this.searchTerm.trim()) : null;

    const results: string[] = [];
    for (const entry of this.flatFileIndex.values()) {
      if (entry.isDirectory) {continue;}

      const hay = isPathy ? entry.relativePath.toLowerCase() : entry.name.toLowerCase();
      const match =
        (glob ? glob.test(entry.relativePath.replace(/\\/g, '/')) : hay.includes(term));

      if (match) {results.push(entry.path);}
    }

    return results.sort();
  }

  /**
   * Reveal a path in the tree view using VS Code's TreeView.reveal API
   * This properly uses the tree view API to show and select items
   */
  public async revealPath(absolutePath: string, opts?: { select?: boolean; focus?: boolean; expand?: boolean }): Promise<void> {
    if (!this._treeView) {
      console.warn('TreeView not initialized, cannot reveal path');
      return;
    }

    try {
      // First ensure parent directories are expanded
      await this.expandToShowFile(absolutePath);
      
      // Create a FileItem for the path
      const uri = vscode.Uri.file(absolutePath);
      const stats = fs.statSync(absolutePath);
      const isDir = stats.isDirectory();
      const collapsibleState = isDir
        ? vscode.TreeItemCollapsibleState.Collapsed 
        : vscode.TreeItemCollapsibleState.None;
      
      const fileItem = new FileItem(uri, collapsibleState, isDir, absolutePath);
      
      // Use TreeView reveal API
      await this._treeView.reveal(fileItem, {
        select: opts?.select ?? true,
        focus: opts?.focus ?? false,
        expand: opts?.expand ?? true
      });
    } catch (err) {
      console.warn(`Failed to reveal ${absolutePath}:`, err);
    }
  }


  /**
   * Expands the tree to show a specific file
   * @param absolutePath The absolute path of the file to reveal
   */
  public async expandToShowFile(absolutePath: string): Promise<void> {
    // Get all parent directories
    const parents: string[] = [];
    let currentPath = path.dirname(absolutePath);
    
    // Build list of parent directories from the file up to the workspace root
    while (currentPath && currentPath !== path.dirname(currentPath)) {
      // Check if we've reached a workspace root
      const isWorkspaceRoot = Array.from(this.workspaceRoots.values()).some(root => root === currentPath);
      
      parents.unshift(currentPath); // Add to beginning to expand from root down
      
      if (isWorkspaceRoot) {
        break; // Stop at workspace root
      }
      
      currentPath = path.dirname(currentPath);
    }
    
    // Expand each parent directory
    for (const parentPath of parents) {
      // Defensive check to ensure expandedItems is available
      if (!expandedItems?.has(parentPath)) {
        expandedItems?.set(parentPath, true);
      }
    }
    
    // Trigger a refresh to update the tree
    this._onDidChangeTreeData.fire();
  }

  // --- RESTORED: Method to set checked items from a list ---
  public async setCheckedItems(absoluteFilePaths: Set<string>, addToExisting: boolean = false): Promise<void> {
    console.log(`Restored setCheckedItems: Received ${absoluteFilePaths.size} absolute paths. Add to existing: ${addToExisting}`);
    if (!this.ignoreHelper) {
        console.warn('Ignore helper not initialized, cannot filter based on ignore rules.');
        // Optionally, initialize it here if feasible or throw an error
    }

    // Clear existing selections only if not adding to existing
    if (!addToExisting) {
      checkedItems.clear();
    }

    // Set initial checked state for provided files, respecting ignore rules
    let checkedCount = 0;
    for (const filePath of absoluteFilePaths) {
        // Use the public shouldIgnore method we are also restoring/ensuring exists
        if (this.ignoreHelper?.shouldIgnore(filePath)) {
            console.log(`Ignoring file from list: ${filePath}`);
            continue;
        }
        try {
            // Verify the file exists and is a file before checking it
            const stats = await fs.promises.stat(filePath);
            if (stats.isFile()) {
                checkedItems.set(filePath, vscode.TreeItemCheckboxState.Checked);
                checkedCount++;
            } else {
                 console.warn(`Path from list is not a file, skipping: ${filePath}`);
            }
        } catch (error) {
            // Handle errors like file not found, permission denied
             if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
                 console.warn(`File from list not found, skipping: ${filePath}`);
             } else if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EACCES') {
                 console.warn(`Permission denied for file from list, skipping: ${filePath}`);
             } else {
                console.error(`Error stating file from list ${filePath}:`, error);
            }
        }
    }
    console.log(`Checked ${checkedCount} files after filtering and validation.`);

    // Update parent states for all checked items
    // Collect unique parent directories first
    const parentDirsToUpdate = new Set<string>();
    for (const [filePath, isChecked] of checkedItems.entries()) {
        if (isChecked) {
            const parentDir = path.dirname(filePath);
            // Ensure we don't try to update the root/invalid paths
            if (parentDir && parentDir !== filePath) {
                 parentDirsToUpdate.add(parentDir);
            }
        }
    }

    console.log(`Updating parent states for ${parentDirsToUpdate.size} directories.`);
    // Update parent chains
    // Process updates sequentially to avoid potential race conditions
    for (const dirPath of parentDirsToUpdate) {
        try {
            await this.updateParentChain(dirPath);
        } catch(error) {
             console.error(`Error updating parent chain for ${dirPath} during list processing:`, error);
        }
    }
     console.log(`Finished updating parent states.`);


    // Rebuild aggregation after bulk changes
    this.rebuildDirAggregation();
    
    // Refresh the tree view to show new states
    this.refresh();

    // Notify the webview about the change
    vscode.commands.executeCommand('promptcode.getSelectedFiles');
  }
  // --- END RESTORED ---

  // --- ADDED: Get selected file paths (relative to workspace root) ---
  public getSelectedPaths(): string[] {
    if (!this.workspaceRoots.size) {
      return [];
    }
    const selectedPaths: string[] = [];
    const workspaceRootPaths = Array.from(this.workspaceRoots.values());

    for (const [fullPath, state] of checkedItems.entries()) {
      if (state === vscode.TreeItemCheckboxState.Checked) {
        // Check if it's a file (or handle directories if needed)
        try {
          // Only include files, not directories, in the path list
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
             // Find the workspace root this path belongs to
            const containingRoot = workspaceRootPaths.find(root => fullPath.startsWith(root + path.sep));
            if (containingRoot) {
              selectedPaths.push(path.relative(containingRoot, fullPath));
            } else {
               console.warn(`Selected path ${fullPath} does not belong to any known workspace root.`);
            }
          }
        } catch (error) {
          // Ignore errors if file was deleted between selection and this call
           if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
              console.error(`Error stating file ${fullPath} in getSelectedPaths:`, error);
           }
        }
      }
    }
    return selectedPaths;
  }
  // --- END ADDED ---

  // --- ADDED: Select files programmatically based on relative paths ---
  public async selectFiles(relativePaths: string[], addToExisting: boolean = false): Promise<void> {
    console.log(`FileExplorerProvider: selectFiles called with ${relativePaths.length} paths. Add to existing: ${addToExisting}`);
    console.log(`[DEBUG] First few relative paths:`, relativePaths.slice(0, 3));
    
    if (!this.workspaceRoots.size) {
      console.warn('selectFiles called with no workspace roots.');
      return;
    }

    console.log(`[DEBUG] Workspace roots:`, Array.from(this.workspaceRoots.values()));
    
    const absolutePaths = new Set<string>();
    const workspaceRootEntries = Array.from(this.workspaceRoots.entries()); // [[uriString, fsPath], ...]

    // Convert relative paths to absolute paths based on workspace roots
    for (const relativePath of relativePaths) {
        let foundRoot = false;
        for (const [, rootPath] of workspaceRootEntries) {
            const absolutePath = path.resolve(rootPath, relativePath); // Use resolve for robustness
            // Basic check: Does the resolved path still seem to be within the root?
            // This isn't perfect but prevents issues with paths like ../../outside
            if (absolutePath.startsWith(rootPath)) {
                 // Check if the file actually exists before adding
                 try {
                    await fs.promises.access(absolutePath, fs.constants.F_OK);
                    absolutePaths.add(absolutePath);
                    foundRoot = true;
                    console.log(`[DEBUG] Successfully resolved: ${relativePath} -> ${absolutePath}`);
                    break; // Assume first match is correct for simplicity
                 } catch (err) {
                    // File doesn't exist or isn't accessible
                    console.warn(`[DEBUG] Preset file path not found or inaccessible, skipping: ${absolutePath} (from relative: ${relativePath})`);
                    console.warn(`[DEBUG] Error details:`, err);
                 }
            }
        }
        if (!foundRoot) {
            console.warn(`Could not resolve relative path "${relativePath}" within any workspace root.`);
        }
    }

    console.log(`[DEBUG] Resolved ${relativePaths.length} relative paths to ${absolutePaths.size} existing absolute paths.`);
    if (absolutePaths.size === 0) {
      console.error(`[DEBUG] ERROR: No files could be resolved! Check if files exist and are accessible.`);
      vscode.window.showErrorMessage(`Could not find any files from the preset. The files may not exist or may not be accessible.`);
      return;
    }
    console.log(`[DEBUG] Calling setCheckedItems with ${absolutePaths.size} paths`);
    // Use the existing setCheckedItems logic
    await this.setCheckedItems(absolutePaths, addToExisting);
    console.log(`[DEBUG] setCheckedItems completed`);
    
    // Force auto-expansion to show selected items
    if (absolutePaths.size > 0) {
      // Get first few selected paths to expand
      const pathsToExpand = Array.from(absolutePaths).slice(0, 10);
      for (const filePath of pathsToExpand) {
        await this.expandToShowFile(filePath);
      }
    }
    
    // Update file decorations for all selected paths
    this.updateDecorations(Array.from(absolutePaths));
  }
  // --- END ADDED ---

  // FileDecorationProvider implementation for tri-state visual indication
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const filePath = uri.fsPath;
    
    // Use flat index to check if it's a directory (O(1) lookup)
    const fileInfo = this.flatFileIndex.get(filePath);
    if (!fileInfo?.isDirectory) {
      return undefined;
    }
    
    // Use aggregated state for O(1) lookup instead of recursive walk
    const agg = this.dirSelectionAgg.get(filePath);
    if (!agg || agg.total === 0) {
      return undefined;
    }
    
    if (agg.checked === 0) {
      return undefined; // No decoration for unselected
    }
    
    if (agg.checked === agg.total) {
      return {
        badge: '●',
        tooltip: 'All items selected',
        color: new vscode.ThemeColor('gitDecoration.addedResourceForeground')
      };
    }
    
    return {
      badge: '◐',
      tooltip: 'Partially selected',
      color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
    };
  }

  // Helper: Update aggregated directory state when file selection changes
  private updateDirAggregation(filePath: string, deltaChecked: number, isFile: boolean): void {
    if (!isFile) {return;} // Only aggregate file selections
    
    let currentPath = path.dirname(filePath);
    const roots = new Set(this.workspaceRoots.values());
    
    while (currentPath && currentPath !== path.dirname(currentPath)) {
      const entry = this.dirSelectionAgg.get(currentPath) ?? { total: 0, checked: 0 };
      
      // Update checked count
      entry.checked = Math.max(0, entry.checked + deltaChecked);
      
      // Update total count (increment only when a file is first seen)
      if (deltaChecked > 0 && entry.total === entry.checked - deltaChecked) {
        entry.total++;
      }
      
      this.dirSelectionAgg.set(currentPath, entry);
      
      // Stop at workspace root
      if (roots.has(currentPath)) {break;}
      currentPath = path.dirname(currentPath);
    }
  }

  // Rebuild aggregation from scratch based on current checkedItems
  private rebuildDirAggregation(): void {
    this.dirSelectionAgg.clear();
    
    // Count all visible files per directory from flat index
    for (const [filePath, fileInfo] of this.flatFileIndex) {
      if (fileInfo.isDirectory) {continue;}
      if (this.ignoreHelper?.shouldIgnore(filePath)) {continue;}
      
      let currentPath = path.dirname(filePath);
      const roots = new Set(this.workspaceRoots.values());
      
      while (currentPath && currentPath !== path.dirname(currentPath)) {
        const entry = this.dirSelectionAgg.get(currentPath) ?? { total: 0, checked: 0 };
        entry.total++;
        
        // Count if this file is checked
        if (checkedItems.has(filePath)) {
          entry.checked++;
        }
        
        this.dirSelectionAgg.set(currentPath, entry);
        
        if (roots.has(currentPath)) {break;}
        currentPath = path.dirname(currentPath);
      }
    }
  }

  private getDirectoryChildrenState(dirPath: string): 'none' | 'partial' | 'all' {
    // Synchronously gather all visible (non-ignored) files under dirPath
    const visibleFiles: string[] = [];
    
    const walkSync = (currentPath: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch {
        // Directory not accessible, skip
        return;
      }
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        // Skip ignored files
        if (this.ignoreHelper?.shouldIgnore(fullPath)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          // Recursively walk subdirectories
          walkSync(fullPath);
        } else if (entry.isFile()) {
          // Add visible files to our list
          visibleFiles.push(fullPath);
        }
      }
    };
    
    // Start walking from the target directory
    walkSync(dirPath);
    
    // If no visible files, directory is effectively empty
    if (visibleFiles.length === 0) {
      return 'none';
    }
    
    // Count how many visible files are checked
    let checkedCount = 0;
    for (const file of visibleFiles) {
      if (checkedItems.get(file) === vscode.TreeItemCheckboxState.Checked) {
        checkedCount++;
      }
    }
    
    // Determine state based on checked count
    if (checkedCount === 0) {
      return 'none';
    } else if (checkedCount === visibleFiles.length) {
      return 'all';
    } else {
      return 'partial';
    }
  }

  // Trigger decoration updates when selection changes
  private updateDecorations(paths?: string[]): void {
    if (paths && paths.length > 0) {
      // Update decorations for specific paths and their parents
      const uris: vscode.Uri[] = [];
      for (const filePath of paths) {
        uris.push(vscode.Uri.file(filePath));
        // Also update parent directories
        let parentPath = path.dirname(filePath);
        while (parentPath && parentPath !== path.dirname(parentPath)) {
          uris.push(vscode.Uri.file(parentPath));
          parentPath = path.dirname(parentPath);
        }
      }
      this._onDidChangeFileDecorations.fire(uris);
    } else {
      // Update all decorations
      this._onDidChangeFileDecorations.fire(undefined);
    }
  }
}