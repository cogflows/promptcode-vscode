import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IgnoreHelper } from './ignoreHelper';

// Map to keep track of checked items
export const checkedItems = new Map<string, vscode.TreeItemCheckboxState>();
// Map to track expanded nodes
export const expandedItems = new Map<string, boolean>();

// Decoration isolation: add a query flag to URIs in our tree only
const DECORATION_QUERY = 'pc=1';
const withDecorQuery = (uri: vscode.Uri) => uri.with({ query: DECORATION_QUERY });

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
      // This command accepts a Uri and opens it; matches our argument type
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
  
  private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> = this._onDidChangeFileDecorations.event;
  
  private searchTerm: string = '';
  private isGlobSearch: boolean = false;
  private includeFoldersInSearch: boolean = false;
  private cachedEntries: Map<string, fs.Dirent[]> = new Map();
  private _treeView: vscode.TreeView<FileItem> | undefined;
  private disposables: vscode.Disposable[] = [];
  private ignoreHelper: IgnoreHelper | undefined;
  private workspaceRoots: Map<string, string> = new Map(); // Uri string -> fsPath
  private includedPaths: Set<string> = new Set();
  private checkboxQueue: Promise<void> = Promise.resolve(); // selection mutation queue
  private searchSequence: number = 0; // For search cancellation
  private expandRunId: number = 0; // For expansion cancellation
  private pendingExpansion: Promise<void> | null = null; // Track pending expansion for tests
  // searchTimer removed - using debounceWaiters pattern instead
  private debounceWaiters: Array<() => void> = []; // For shared debounce
  private debounceHandle: NodeJS.Timeout | null = null;
  
  // Decoration cache for O(1) lookups
  private dirDecorationCache: Map<string, {checked: number, total: number}> = new Map();
  
  // Debug flag - can be enabled via environment variable
  private readonly debugMode = process.env.PROMPTCODE_DEBUG === 'true';
  
  private debugLog(...args: any[]): void {
    if (this.debugMode) {
      console.log(...args);
    }
  }

  constructor() {
    // ... (constructor initialization remains the same) ...
    this.initializeWorkspaceRoots();

    // Initialize the ignore helper
    this.ignoreHelper = new IgnoreHelper();
    this.ignoreHelper.initialize().then(() => {
      // Initialize decoration cache
      this.updateDecorationCache();
      // Refresh the tree view after ignore patterns are loaded
      this.refresh();
    }).catch(error => {
      console.error('Error initializing ignore helper:', error);
    });

    // Set up file system watchers for all workspace folders
    this.setupFileSystemWatchers();

    // Listen for workspace folder changes
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(e => {
        this.handleWorkspaceFoldersChanged(e);
      })
    );

    // Also listen for VS Code's built-in file events
    this.disposables.push(
      vscode.workspace.onDidCreateFiles(() => {
        this.refreshDecorations();
        this.refresh();
      }),
      vscode.workspace.onDidDeleteFiles(() => {
        this.refreshDecorations();
        this.refresh();
      }),
      vscode.workspace.onDidRenameFiles(() => {
        this.refreshDecorations();
        this.refresh();
      })
    );
  }

  // ... (rest of the FileExplorerProvider class remains the same) ...
  public initializeWorkspaceRoots(): void {
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        this.workspaceRoots.set(folder.uri.toString(), folder.uri.fsPath);
      }
    }
  }

  private handleWorkspaceFoldersChanged(e: vscode.WorkspaceFoldersChangeEvent): void {
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

    // Refresh view
    this.refresh();
  }

  private removeFilesFromSelection(rootPath: string): void {
    // Collect paths to remove
    const pathsToRemove: string[] = [];
    for (const [path, checked] of checkedItems.entries()) {
      if (path.startsWith(rootPath)) {
        pathsToRemove.push(path);
      }
    }
    
    // Use centralized mutation if there are paths to remove
    if (pathsToRemove.length > 0) {
      this.applySelectionMutation(
        `Removing ${pathsToRemove.length} files from deleted workspace…`,
        async () => {
          for (const path of pathsToRemove) {
            checkedItems.delete(path);
          }
        },
        pathsToRemove
      );
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
          this.refreshIgnoreHelper().finally(() => {
            // Ignore rules changed => totals changed even if selection didn't
            this.refreshDecorations();
            this.refresh();
          });
        } else {
          // File structure changed => totals changed
          this.refreshDecorations([uri.fsPath]);
          this.refresh();
        }
      }),
      fileWatcher.onDidDelete((uri) => {
        const fileName = path.basename(uri.fsPath);
        if (fileName === '.gitignore' || fileName === '.promptcode_ignore') {
          this.refreshIgnoreHelper().finally(() => {
            this.refreshDecorations();
            this.refresh();
          });
        } else {
          this.refreshDecorations([uri.fsPath]);
          this.refresh();
        }
      }),
      fileWatcher.onDidChange((uri) => {
        const fileName = path.basename(uri.fsPath);
        if (fileName === '.gitignore' || fileName === '.promptcode_ignore') {
          this.refreshIgnoreHelper().finally(() => {
            this.refreshDecorations();
            this.refresh();
          });
        } else {
          // File content changes don't affect decorations, only structure changes do
          // this.refresh();
        }
      })
    );
  }

  // Method to dispose watchers when extension is deactivated
  dispose(): void {
    // Clean up search timer if it's active
    // searchTimer cleanup removed - using debounceWaiters pattern
    
    // Dispose all other disposables
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }

  // Set the extension context for state persistence
  setContext(context: vscode.ExtensionContext) {
    // Store context for future use if needed
  }

  // Set the tree view instance
  setTreeView(treeView: vscode.TreeView<FileItem>) {
    this._treeView = treeView;

    // Add listeners for expand/collapse events to track expanded state
    this.disposables.push(
      treeView.onDidExpandElement(e => {
        expandedItems.set(e.element.fullPath, true);
      }),

      treeView.onDidCollapseElement(e => {
        expandedItems.set(e.element.fullPath, false);
      })
    );
  }

  refresh(): void {
    // Clear cache when refreshing
    this.cachedEntries.clear();
    this._onDidChangeTreeData.fire();
  }

  // Public method to refresh decorations (called from extension.ts after webview commands)
  public refreshDecorations(paths?: string[]): void {
    // Always update the cache to ensure it's current
    this.updateDecorationCache();
    
    // Fire decoration change event
    if (paths && paths.length > 0) {
      // Update specific paths and their ancestors
      this.updateDecorations(paths);
    } else {
      // Update all decorations
      this._onDidChangeFileDecorations.fire(undefined);
    }
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
      // Ignore rules affect totals for every directory - must rebuild cache
      this.refreshDecorations();
      this.refresh();
    } catch (error) {
      console.error('Error refreshing ignore helper:', error);
    }
  }

  // Remove ignored and non-existent files from selection
  public cleanupSelectedFiles(): Promise<void> {
    // Create a list of items to remove
    const itemsToRemove: string[] = [];
    const reasons: Map<string, string> = new Map();

    // Check each selected item (files and directories)
    for (const [itemPath, isChecked] of checkedItems.entries()) {
      if (!isChecked) {
        continue;
      }
      
      // Remove if file doesn't exist
      if (!fs.existsSync(itemPath)) {
        itemsToRemove.push(itemPath);
        reasons.set(itemPath, 'non-existent');
        continue;
      }
      
      // Remove if file is ignored (only if ignoreHelper is available)
      if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(itemPath)) {
        itemsToRemove.push(itemPath);
        reasons.set(itemPath, 'ignored');
      }
    }

    // If any items need to be removed, use centralized mutation
    if (itemsToRemove.length > 0) {
      return this.applySelectionMutation(
        `Cleaning up ${itemsToRemove.length} invalid items…`,
        async () => {
          // Remove the items from selection
          for (const itemPath of itemsToRemove) {
            checkedItems.delete(itemPath);

            // Update parent states for this path
            await this.updateParentStates(itemPath).catch(error => {
              console.error(`Error updating parent states for ${itemPath}:`, error);
            });

            const reason = reasons.get(itemPath) || 'unknown';
            this.debugLog(`Removed ${reason} item from selection: ${itemPath}`);
          }
          console.log(`Cleaned up ${itemsToRemove.length} items from selection`);
        },
        itemsToRemove
      );
    }
    // Nothing to do; still let callers await queue idleness
    return this.waitForSelectionIdle();
  }

  // Shared debounce helper that resolves all waiters
  private async waitForDebounce(ms = 200): Promise<void> {
    return new Promise<void>(resolve => {
      this.debounceWaiters.push(resolve);
      if (this.debounceHandle) {
        clearTimeout(this.debounceHandle);
      }
      this.debounceHandle = setTimeout(() => {
        const waiters = this.debounceWaiters.splice(0);
        this.debounceHandle = null;
        waiters.forEach(w => w());   // release all callers
      }, ms);
    });
  }

  // Set the search term and refresh the tree
  async setSearchTerm(searchTerm: string, globPattern?: boolean, shouldIncludeFolders?: boolean): Promise<void> {
    this.debugLog(`FileExplorer: Setting search term to "${searchTerm}", glob: ${globPattern}, includeFolders: ${shouldIncludeFolders}`);
    
    // Cancel any in-flight expand from a previous search
    this.expandRunId++;

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
    this.debugLog(`[setSearchTerm] Starting search for "${searchTermLower}", sequence: ${sequence}`);
    
    // If the term is empty, clear immediately to keep the UI snappy
    if (!this.searchTerm.trim()) {
      this.includedPaths.clear();
      this.refresh();
      return;
    }
    
    // Kick off processing without awaiting, so callers don't serialize the debounce
    void this.processSearch(sequence);
  }

  // Process the search after debouncing
  private async processSearch(sequence: number): Promise<void> {
    await this.waitForDebounce(200);

    // Cancel stale runs
    if (sequence !== this.searchSequence) {
      this.debugLog(`[processSearch] Search superseded, sequence ${sequence} !== ${this.searchSequence}, returning early`);
      return;
    }
    this.debugLog(`[processSearch] Proceeding with search, sequence ${sequence} === ${this.searchSequence}`);

    try {
      await this.rebuildSearchPaths(sequence);
    } catch (error) {
      console.error('[processSearch] Error in rebuildSearchPaths:', error);
    }

    // Cancel if superseded while rebuilding
    if (sequence !== this.searchSequence) {
      return;
    }

    // Refresh, then expand
    this.refresh();

    // Only schedule expansion if we actually have results
    if (this.includedPaths.size > 0) {
      const runId = ++this.expandRunId;
      queueMicrotask(() => {
        if (this._treeView && sequence === this.searchSequence && runId === this.expandRunId) {
          const expansionPromise = this.expandMatchingDirectories(runId)
            .catch(err => console.error('Error expanding search matches:', err))
            .finally(() => {
              if (this.pendingExpansion === expansionPromise) {
                this.pendingExpansion = null;
              }
            });
          this.pendingExpansion = expansionPromise;
        }
      });
    } else {
      // Clear pending expansion when no results
      this.pendingExpansion = null;
    }

    // Optional single-result auto-select
    const files = await this.getCurrentSearchResults();
    if (sequence === this.searchSequence && files.length === 1) {
      const singlePath = files[0];
      checkedItems.clear();
      checkedItems.set(singlePath, vscode.TreeItemCheckboxState.Checked);
      this.updateDecorationCache();
      this.refresh();
      vscode.commands.executeCommand('promptcode.getSelectedFiles');
    }
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
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return null; // Not a glob pattern
    }

    // Normalize path separators to forward slashes
    pattern = pattern.replace(/\\/g, '/');

    // Escape characters with special meaning in regex (except *, ?, /)
    let escapedPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&'); 

    // Convert glob patterns to regex:
    // ** matches any number of directories (including zero)
    // * matches any characters except path separator
    // ? matches single character except path separator
    
    // IMPORTANT: handle **/ specially so the slash is optional when ** matches zero dirs.
    let regexString = escapedPattern
      .replace(/\*\*\/+/g, '{{GLOBSTAR_SLASH}}')  // Temporarily mark **/ patterns
      .replace(/\*\*/g, '{{GLOBSTAR}}')           // Temporarily mark ** patterns
      .replace(/\*/g, '[^/]*')                    // * matches anything except /
      .replace(/\?/g, '[^/]')                     // ? matches single char except /
      .replace(/{{GLOBSTAR_SLASH}}/g, '(?:.*/)?') // **/ -> zero or more directories (slash optional)
      .replace(/{{GLOBSTAR}}/g, '.*');            // ** -> anything including /

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
  private async rebuildSearchPaths(sequence: number): Promise<void> {
    this.debugLog(`[rebuildSearchPaths] START for term: "${this.searchTerm}", isGlob: ${this.isGlobSearch}, sequence: ${sequence}`);
    // Build results in local set to avoid race conditions
    const nextIncluded = new Set<string>();
    const directMatches = new Set<string>(); // Set for Pass 1 results

    if (!this.searchTerm.trim()) {
      this.debugLog(`[Debug] rebuildSearchPaths: Search term is empty. No filtering needed.`);
      // Clear includedPaths when search is cleared
      this.includedPaths.clear();
      // No need to refresh here, getChildren will handle showing everything
      return;
    }

    const normalizedSearchTerm = this.searchTerm.trim().toLowerCase();
    const isPathSearch = normalizedSearchTerm.includes('/') || normalizedSearchTerm.includes('\\');
    
    // Create glob regex - use the same regex for both path and filename matching
    const globRegex = this.isGlobSearch ? this.globToRegex(this.searchTerm.trim()) : null;
    this.debugLog(`[rebuildSearchPaths] Glob regex created: ${globRegex}`);
    this.debugLog(`[Debug] rebuildSearchPaths: Normalized term: "${normalizedSearchTerm}", Is path search: ${isPathSearch}, Is glob: ${this.isGlobSearch}, Include folders: ${this.includeFoldersInSearch}`);

    // --- PASS 1: Find Direct Matches (by name or path) --- 
    this.debugLog("[Debug] rebuildSearchPaths: Starting Pass 1 (Finding direct matches)");
    const findDirectMatchesRecursive = async (dirPath: string, rootPath: string): Promise<void> => {
      // Check if search was cancelled
      if (sequence !== this.searchSequence) {return;}
      
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          // Check if search was cancelled
          if (sequence !== this.searchSequence) {return;}
          
          // Skip symbolic links to prevent infinite loops
          if (entry.isSymbolicLink && entry.isSymbolicLink()) {continue;}
          const fullPath = path.join(dirPath, entry.name);
          const entryName = entry.name; // Use original name for glob matching
          const entryNameLower = entryName.toLowerCase();

          // Skip ignored files/directories
          if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath)) {
            continue;
          }

          // Check if entry matches
          let isMatch = false;
          
          if (isPathSearch) {
            // For path searches, check the relative path from workspace root
            const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
            const relativePathLower = relativePath.toLowerCase();
            
            if (globRegex) {
              // Apply glob pattern to the full relative path
              isMatch = globRegex.test(relativePath);
            } else {
              // Fallback to substring match for non-glob path searches
              isMatch = relativePathLower.includes(normalizedSearchTerm.replace(/\\/g, '/'));
            }
          } else if (this.isGlobSearch) {
            // For filename glob patterns, test against the file name
            // If no wildcards, fall back to substring match
            isMatch = globRegex ? globRegex.test(entryName) : entryNameLower.includes(normalizedSearchTerm);
          } else {
            // Simple search: directories still match by name only (when allowed),
            // files match by filename OR relative path fragment.
            if (entry.isDirectory()) {
              isMatch = this.includeFoldersInSearch && entryNameLower.includes(normalizedSearchTerm);
            } else {
              const relativePathLower = path
                .relative(rootPath, fullPath)
                .replace(/\\/g, '/')
                .toLowerCase();
              isMatch = entryNameLower.includes(normalizedSearchTerm)
                     || relativePathLower.includes(normalizedSearchTerm);
            }
          }

          // Handle include folders option - skip directories if not included
          if (isMatch && entry.isDirectory() && !this.includeFoldersInSearch) {
            isMatch = false;
          }

          if (isMatch) {
            directMatches.add(fullPath);
          }

          // Recurse into directories
          if (entry.isDirectory()) {
            await findDirectMatchesRecursive(fullPath, rootPath);
          }
        }
      } catch (error) {
        // Ignore errors like permission denied
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'EACCES' && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`Error during Pass 1 scan in ${dirPath}:`, error);
        }
      }
    };

    // Run Pass 1 for each workspace root
    this.debugLog(`[rebuildSearchPaths] Workspace roots count: ${this.workspaceRoots.size}`);
    for (const rootPath of this.workspaceRoots.values()) {
      this.debugLog(`[rebuildSearchPaths] Scanning root: ${rootPath}`);
      await findDirectMatchesRecursive(rootPath, rootPath);
    }

    // Print sorted direct matches
    const sortedDirectMatches = Array.from(directMatches).sort();
    this.debugLog(`[rebuildSearchPaths] Direct matches found: ${directMatches.size}`);
    this.debugLog(`[Debug] rebuildSearchPaths: Pass 1 Results (Direct Matches):`, sortedDirectMatches);

    // If no direct matches found, no need for Pass 2
    if (directMatches.size === 0) {
        this.debugLog("[Debug] rebuildSearchPaths: No direct matches found, skipping Pass 2.");
        // Clear includedPaths when no matches
        this.includedPaths.clear();
        // Clear expandedItems to prevent stale state from auto-expanding
        expandedItems.clear();
        // Also cancel any in-flight expansion work
        this.expandRunId++;
        return;
    }

    // --- PASS 2: Add Ancestors and Descendants --- 
    this.debugLog("[Debug] rebuildSearchPaths: Starting Pass 2 (Adding ancestors and descendants)");
    // Build into local set, not this.includedPaths
    nextIncluded.clear();
    for (const match of directMatches) {
      nextIncluded.add(match);
    }

    // Helper function to add all descendants recursively
    const addDescendantsRecursive = async (dirPath: string): Promise<void> => {
      // Check if search was cancelled
      if (sequence !== this.searchSequence) {return;}
      
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          // Check if search was cancelled
          if (sequence !== this.searchSequence) {return;}
          
          // Skip symbolic links to prevent infinite loops
          if (entry.isSymbolicLink && entry.isSymbolicLink()) {continue;}
          const fullPath = path.join(dirPath, entry.name);
          // Skip ignored items
          if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath)) {
            continue;
          }
          // Add the descendant to local set
          nextIncluded.add(fullPath);
          // Recurse if it's a directory
          if (entry.isDirectory()) {
            await addDescendantsRecursive(fullPath);
          }
        }
      } catch (error) {
         // Ignore errors like permission denied
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'EACCES' && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`Error adding descendants for ${dirPath}:`, error);
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

        nextIncluded.add(parentPath); // Add ancestor to local set

        // Stop if we hit a workspace root
        const isWorkspaceRoot = Array.from(this.workspaceRoots.values()).some(root => parentPath === root);
        if (isWorkspaceRoot) {
          break;
        }
        currentPath = parentPath;
      }

      // 2b: Add Descendants (if it's a directory)
      try {
        // Use lstat to avoid following symbolic links
        const stats = await fs.promises.lstat(matchPath);
        if (stats.isDirectory()) {
          await addDescendantsRecursive(matchPath);
        }
      } catch (error) {
        // Ignore errors if item was deleted between passes
         if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
             console.error(`Error stating direct match ${matchPath} for descendant check:`, error);
         }
      }
    }

    // Only commit results if this is still the current search
    if (sequence === this.searchSequence) {
      this.includedPaths = nextIncluded;
      this.debugLog(`[Debug] rebuildSearchPaths: Pass 2 Complete. Final includedPaths size: ${this.includedPaths.size}`);
    } else {
      this.debugLog(`[Debug] rebuildSearchPaths: Search cancelled (sequence ${sequence} != ${this.searchSequence})`);
    }
  }

  // Check if an item should be included in search results based on the inclusion set
  private shouldIncludeInSearch(fullPath: string, isDirectory: boolean): boolean {
    // If no search term is active, include everything
    if (!this.searchTerm.trim()) {
      return true;
    }

    // Otherwise, include only if the path exists in the final includedPaths set
    const include = this.includedPaths.has(fullPath);
    this.debugLog(`[Debug] shouldIncludeInSearch: Checking "${fullPath}". Included: ${include}`); // Simplified log
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
      if (this.cachedEntries.has(directoryPath)) {
        return this.processDirectoryEntries(directoryPath, this.cachedEntries.get(directoryPath)!);
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
    // IMPORTANT: add query flag so only our tree's URIs get decorations
    const resourceUri = withDecorQuery(vscode.Uri.file(fullPath));
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
            return !this.ignoreHelper!.shouldIgnore(fullPath);
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
        return !this.ignoreHelper!.shouldIgnore(fullPath);
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
          // During search, use the expandedItems to determine state
          entry.isDirectory() ? 
            (expandedItems.get(fullPath) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : 
            vscode.TreeItemCollapsibleState.None
        );

        // The FileItem constructor already sets the checkbox state correctly from checkedItems
        // No need to override it here

        return fileItem;
      });
    }


    // No search term, return all filtered entries
    return filteredEntries.map(entry => {
      const fullPath = path.join(directoryPath, entry.name);
      const fileItem = this.createFileItem(
        entry,
        directoryPath,
        // When not searching, use expandedItems to restore state
        entry.isDirectory() ? 
          (expandedItems.get(fullPath) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : 
          vscode.TreeItemCollapsibleState.None
      );

      // Ensure checkbox state is preserved
      if (checkedItems.has(fullPath)) {
        fileItem.checkboxState = checkedItems.get(fullPath) ?? vscode.TreeItemCheckboxState.Unchecked;
      }

      return fileItem;
    });
  }

  // Centralized method for all selection mutations to ensure consistent ordering
  public applySelectionMutation(
    label: string,
    mutator: () => Promise<void> | void,
    affectedPaths?: string[],
    useIncrementalUpdate: boolean = false
  ): Promise<void> {
    const run = this.checkboxQueue = this.checkboxQueue
      .then(() => vscode.window.withProgress({
        cancellable: false,
        location: vscode.ProgressLocation.Window,
        title: label || 'Updating selection…'
      }, async () => {
        try {
          // Step 1: Apply the mutation to checkedItems
          const previousState = affectedPaths && affectedPaths.length === 1 ? 
            checkedItems.get(affectedPaths[0]) : undefined;
          await mutator();
          
          // Step 2: Update the decoration cache
          // Use incremental update for single file changes, full rebuild otherwise
          if (useIncrementalUpdate && affectedPaths && affectedPaths.length === 1) {
            const filePath = affectedPaths[0];
            const currentState = checkedItems.get(filePath);
            const isNowChecked = currentState === vscode.TreeItemCheckboxState.Checked;
            const wasChecked = previousState === vscode.TreeItemCheckboxState.Checked;
            
            if (isNowChecked !== wasChecked) {
              this.updateDecorationCacheForFile(filePath, isNowChecked);
            }
          } else {
            // Full rebuild for directories or bulk operations
            this.updateDecorationCache();
          }
          
          // Step 3: Fire decoration change events
          if (affectedPaths && affectedPaths.length > 0) {
            this.updateDecorations(affectedPaths);
          } else {
            this._onDidChangeFileDecorations.fire(undefined);
          }
          
          // Step 4: Refresh the tree view
          this.refresh();
          
          // Step 5: Notify the webview
          await vscode.commands.executeCommand('promptcode.getSelectedFiles');
        } catch (error) {
          console.error('Selection mutation error:', error);
          vscode.window.showErrorMessage(`Failed to update selection: ${error}`);
          // Still refresh on error to clear bad state
          this.refresh();
        }
      }))
      .catch(err => {
        console.error('Checkbox queue error:', err);
        this.refresh();
      });
    return run;
  }

  // Handle checkbox state changes
  handleCheckboxToggle(item: FileItem, state: vscode.TreeItemCheckboxState): void {
    // Ignore no-ops – saves queue slots
    if (checkedItems.get(item.fullPath) === state) { return; }

    // For single file changes, use optimized incremental update
    const isSingleFile = !item.isDirectory;
    
    this.applySelectionMutation(
      'Updating selection…',
      async () => {
        await this.processCheckboxChange(item, state);
      },
      [item.fullPath],
      isSingleFile // Pass flag to use incremental update
    );
  }

  // Process checkbox changes synchronously to avoid race conditions
  private async processCheckboxChange(item: FileItem, state: vscode.TreeItemCheckboxState): Promise<void> {
    // Step 1: Update the current item's state (delete if unchecked to save memory)
    if (state === vscode.TreeItemCheckboxState.Unchecked) {
      checkedItems.delete(item.fullPath);
    } else {
      checkedItems.set(item.fullPath, state);
    }

    // Step 2: If it's a directory, update all children
    if (item.isDirectory) {
      const isChecked = state === vscode.TreeItemCheckboxState.Checked;
      await this.setAllChildrenState(item.fullPath, isChecked);
    }

    // Step 3: Update all parent directories up to the root
    await this.updateParentChain(path.dirname(item.fullPath));
    
    // Note: Decoration cache update moved to handleCheckboxToggle to avoid race condition
    // between _onDidChangeFileDecorations and _onDidChangeTreeData events
  }

  // Set checkbox state for all children (simplifying previous methods)
  private async setAllChildrenState(dirPath: string, isChecked: boolean): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const state = isChecked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;

      for (const entry of entries) {
        // Skip symbolic links to prevent infinite loops
        if (entry.isSymbolicLink && entry.isSymbolicLink()) {continue;}
        
        const fullPath = path.join(dirPath, entry.name);

        // Skip ignored items
        if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath)) {
          continue;
        }

        // Set the state (delete if unchecked to save memory)
        if (state === vscode.TreeItemCheckboxState.Unchecked) {
          checkedItems.delete(fullPath);
        } else {
          checkedItems.set(fullPath, state);
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
  public async updateParentChain(dirPath: string | undefined): Promise<void> {
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
          // Only delete if it wasn't previously in the map
          if (!checkedItems.has(dirPath)) {
            checkedItems.delete(dirPath);
          }
          // Otherwise keep the existing state (user may have explicitly checked an empty dir)
      } else {
        const allChecked = childStates.every(state => state === vscode.TreeItemCheckboxState.Checked);
        const allUnchecked = childStates.every(state => state === vscode.TreeItemCheckboxState.Unchecked);
        
        if (allChecked) {
          // All children checked -> parent checked
          checkedItems.set(dirPath, vscode.TreeItemCheckboxState.Checked);
        } else if (allUnchecked) {
          // All children unchecked -> delete parent entry
          checkedItems.delete(dirPath);
        } else {
          // Mixed state -> delete parent entry (indeterminate)
          checkedItems.delete(dirPath);
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
        if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath)) {
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
  
  // Test helper: wait for search and expansion to complete
  public async waitForSearchIdle(): Promise<void> {
    // Wait for debounce window to flush any pending processSearch scheduling
    await new Promise(r => setTimeout(r, 0));
    const p = this.pendingExpansion;
    if (p) { 
      await p; 
    }
  }
  
  /** Test/helper: await until current selection-mutation queue is idle */
  public async waitForSelectionIdle(): Promise<void> {
    try {
      await this.checkboxQueue;
    } catch {
      // Swallow errors so callers don't get stuck on a rejected queue
    }
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
    this.debugLog('expandAll method called in FileExplorerProvider');

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
      this.debugLog(`Found ${directories.length} directories to expand`);

      // Limit to max directories to prevent performance issues
      const maxDirectories = 100; // Increased limit slightly

      // Limit directories to process if needed
      const directoriesToProcess = directories.length > maxDirectories
        ? directories.slice(0, maxDirectories)
        : directories;

      if (directories.length > maxDirectories) {
        vscode.window.showWarningMessage(`Expanding first ${maxDirectories} directories due to large workspace size.`);
        this.debugLog(`Limited expansion to ${maxDirectories} directories (out of ${directories.length}`);
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
            this.debugLog(`Expanding batch ${i / batchSize + 1}...`);
            await revealBatch(batch);
            await delay(100); // Small delay between batches
       }


      this.debugLog('Expand all process completed.');
    } catch (error) {
      console.error('Error expanding directories:', error);
      // Still throw to maintain compatibility with callers expecting exceptions
      throw error;
    }
  }

  // Collapse all directories
  async collapseAll(): Promise<void> {
    this.debugLog('collapseAll method called in FileExplorerProvider');

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

      this.debugLog('All directories collapsed.');
    } catch (error) {
      console.error('Error collapsing directories:', error);
      throw error;
    }
  }

  // Get all directories in the workspace
  private async getAllDirectories(): Promise<FileItem[]> {
    const directories: FileItem[] = [];
    console.log('[getAllDirectories] Called, current expandedItems size:', expandedItems.size);

    // If there's an active search with no results, don't try to get directories
    if (this.searchTerm.trim() && this.includedPaths.size === 0) {
      console.log('[getAllDirectories] Active search with no results - returning empty');
      return [];
    }

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

    const label = checked ? 'Selecting all files…' : 'Clearing selection…';
    
    // Use centralized mutation to ensure proper ordering
    this.applySelectionMutation(
      label,
      async () => {
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

              // Delete unchecked entries to save memory
              if (state === vscode.TreeItemCheckboxState.Unchecked) {
                checkedItems.delete(fullPath);
              } else {
                checkedItems.set(fullPath, state);
              }

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
          // Add/remove the root directory itself
          if (state === vscode.TreeItemCheckboxState.Unchecked) {
            checkedItems.delete(rootPath);
          } else {
            checkedItems.set(rootPath, state);
          }
          await processDirectory(rootPath);
        }
      }
    );
  }

  // Method to expand directories that match the search
  private async expandMatchingDirectories(runId: number): Promise<void> {
    if (runId !== this.expandRunId) {return;}
    
    if (!this._treeView) {
      return;
    }

    // Don't expand anything if there are no search results
    if (this.includedPaths.size === 0 || runId !== this.expandRunId) {
      this.debugLog('No search results, skipping directory expansion');
      console.log('[expandMatchingDirectories] No results - not expanding. expandedItems size:', expandedItems.size);
      return;
    }

    this.debugLog('Expanding directories that match search criteria');

    try {
      // First get all the directories present in the current view (respecting search filter)
      const directories = await this.getAllDirectories(); // This already respects ignore filters
      if (runId !== this.expandRunId) {return;}
      this.debugLog(`Found ${directories.length} potentially visible directories to check for expansion`);

      // Get workspace roots as a Set of paths for checking when to stop
      const rootPaths = new Set(Array.from(this.workspaceRoots.values()));
      
      // Filter directories based on whether they or their ancestors are in the includedPaths set
      const directoriesToExpand = directories.filter(dir => {
         // Check if the directory itself or any of its ancestors are in the inclusion set
         let currentPath = dir.fullPath;
         while (currentPath && currentPath !== path.dirname(currentPath)) {
            if (this.includedPaths.has(currentPath)) {
                return true; // Expand if the directory or an ancestor matches
            }
            // Stop when we reach a workspace root
            if (rootPaths.has(currentPath)) {
              break;
            }
            const parentPath = path.dirname(currentPath);
            if (parentPath === currentPath) {
              break;
            }
            currentPath = parentPath;
         }
         return false;
      });


      this.debugLog(`Will expand ${directoriesToExpand.length} directories relevant to search matches`);


      // Helper function to add delay
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

       // Reveal directories level by level or in batches
      const revealBatch = async (batch: FileItem[]) => {
          if (runId !== this.expandRunId) {return;}
          for (const dir of batch) {
              if (runId !== this.expandRunId) {return;}
              expandedItems.set(dir.fullPath, true); // Mark as expanded first
          }
           // Reveal the batch
           await Promise.all(batch.map(dir =>
                this._treeView!.reveal(dir, { expand: true, select: false }).then(
                    () => {}, // Success handler (optional log)
                    (err) => console.warn(`Could not reveal ${dir.fullPath}: ${err.message}`) // Error handler
                )
            ));
      };


      const batchSize = 50; // Process 50 directories at a time
       for (let i = 0; i < directoriesToExpand.length; i += batchSize) {
            if (runId !== this.expandRunId) {break;}
            const batch = directoriesToExpand.slice(i, i + batchSize);
            this.debugLog(`Expanding search match batch ${i / batchSize + 1}...`);
            await revealBatch(batch);
            if (runId !== this.expandRunId) {break;}
            await delay(100); // Small delay between batches
       }


      this.debugLog('Expansion for search matches completed.');
    } catch (error) {
      console.error('Error expanding matching directories:', error);
    }
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

  // --- RESTORED: Method to set checked items from a list ---
  public async setCheckedItems(absoluteFilePaths: Set<string>, addToExisting: boolean = false): Promise<void> {
    this.debugLog(`Restored setCheckedItems: Received ${absoluteFilePaths.size} absolute paths. Add to existing: ${addToExisting}`);
    
    // Use centralized mutation to ensure proper ordering
    this.applySelectionMutation(
      'Setting selected files…',
      async () => {
        if (!this.ignoreHelper) {
          console.warn('Ignore helper not initialized, cannot filter based on ignore rules.');
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
            this.debugLog(`Ignoring file from list: ${filePath}`);
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
    this.debugLog(`Checked ${checkedCount} files after filtering and validation.`);

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

        this.debugLog(`Updating parent states for ${parentDirsToUpdate.size} directories.`);
        // Update parent chains
        // Process updates sequentially to avoid potential race conditions
        for (const dirPath of parentDirsToUpdate) {
          try {
            await this.updateParentChain(dirPath);
          } catch(error) {
            console.error(`Error updating parent chain for ${dirPath} during list processing:`, error);
          }
        }
        this.debugLog(`Finished updating parent states.`);
      }
    );
  }
  // --- END RESTORED ---

  // Helper to safely check if a path is inside a root directory
  private isPathInside(rootPath: string, candidatePath: string): boolean {
    const root = path.resolve(rootPath);
    const cand = path.resolve(candidatePath);

    // Windows: make comparison case-insensitive
    const norm = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;

    const rel = path.relative(root, cand);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) && norm(cand).startsWith(norm(root) + path.sep);
  }

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
             // Find the workspace root this path belongs to (using safe containment check)
            const containingRoot = workspaceRootPaths.find(root => this.isPathInside(root, fullPath));
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
    this.debugLog(`FileExplorerProvider: selectFiles called with ${relativePaths.length} paths. Add to existing: ${addToExisting}`);
    if (!this.workspaceRoots.size) {
      console.warn('selectFiles called with no workspace roots.');
      return;
    }

    const absolutePaths = new Set<string>();
    const workspaceRootEntries = Array.from(this.workspaceRoots.entries()); // [[uriString, fsPath], ...]

    // Convert relative paths to absolute paths based on workspace roots
    for (const relativePath of relativePaths) {
        let foundRoot = false;
        for (const [, rootPath] of workspaceRootEntries) {
            const absolutePath = path.resolve(rootPath, relativePath); // Use resolve for robustness
            // Safe containment check to prevent path traversal
            if (this.isPathInside(rootPath, absolutePath)) {
                 // Check if the file actually exists before adding
                 try {
                    await fs.promises.access(absolutePath, fs.constants.F_OK);
                    absolutePaths.add(absolutePath);
                    foundRoot = true;
                    break; // Assume first match is correct for simplicity
                 } catch (err) {
                    // File doesn't exist or isn't accessible
                    console.warn(`Preset file path not found or inaccessible, skipping: ${absolutePath} (from relative: ${relativePath})`);
                 }
            }
        }
        if (!foundRoot) {
            console.warn(`Could not resolve relative path "${relativePath}" within any workspace root.`);
        }
    }

    this.debugLog(`Resolved ${relativePaths.length} relative paths to ${absolutePaths.size} existing absolute paths.`);
    // Use the existing setCheckedItems logic
    await this.setCheckedItems(absolutePaths, addToExisting);
  }
  // --- END ADDED ---

  /**
   * Get current search results (files only, no directories)
   * Used for revealing search matches on Enter key
   */
  public async getCurrentSearchResults(): Promise<string[]> {
    // If no search term, return empty
    if (!this.searchTerm || !this.searchTerm.trim()) {
      return [];
    }
    
    // Return only files from includedPaths, not directories
    const files = Array.from(this.includedPaths).filter(p => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    
    return files.sort();
  }

  /**
   * Reveal a path in the tree view
   */
  public async revealPath(absolutePath: string): Promise<void> {
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
        select: true,
        focus: false,
        expand: true
      });
    } catch (err) {
      console.warn(`Failed to reveal ${absolutePath}:`, err);
    }
  }

  /**
   * Expands the tree to show a specific file
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
      expandedItems.set(parentPath, true);
    }
    
    // Trigger a refresh to update the tree
    this._onDidChangeTreeData.fire();
  }

  // FileDecorationProvider implementation for tri-state visual indication
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // Only decorate resources from our tree (file:// + our query flag)
    if (uri.scheme !== 'file' || uri.query !== DECORATION_QUERY) {
      return undefined;
    }
    
    const filePath = uri.fsPath;
    
    // Only provide decorations for items in our checkedItems or dirDecorationCache
    // This limits decorations to files/folders we're actually tracking
    const stats = this.dirDecorationCache.get(filePath);
    if (!stats || stats.total === 0) {
      // Check if it's an individual file we're tracking
      const itemState = checkedItems.get(filePath);
      if (itemState === vscode.TreeItemCheckboxState.Checked) {
        return {
          badge: '●',
          tooltip: 'Selected',
          color: new vscode.ThemeColor('gitDecoration.addedResourceForeground')
        };
      }
      return undefined;
    }
    
    if (stats.checked === 0) {
      return undefined; // No decoration for unselected
    }
    
    if (stats.checked === stats.total) {
      return {
        badge: '●',
        tooltip: 'All items selected',
        color: new vscode.ThemeColor('gitDecoration.addedResourceForeground')
      };
    }
    
    // Partial state
    return {
      badge: '◐',
      tooltip: 'Partially selected',
      color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
    };
  }

  // Debug helper to check decoration stats for a directory
  public dumpDecorationStats(dirPath: string): void {
    const s = this.dirDecorationCache.get(dirPath);
    console.log('[Decorations]', dirPath, s ? `checked=${s.checked}, total=${s.total}` : 'no-entry');
  }

  // Rebuild decoration cache from current checkedItems
  private updateDecorationCache(): void {
    this.dirDecorationCache.clear();
    
    // Recursive bottom-up walk to count all descendants
    const visited = new Set<string>();
    
    const walk = (dirPath: string): { total: number, checked: number } => {
      if (visited.has(dirPath)) {
        const cached = this.dirDecorationCache.get(dirPath);
        return cached || { total: 0, checked: 0 };
      }
      visited.add(dirPath);
      
      let total = 0;
      let checked = 0;
      
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          // Skip symbolic links to prevent infinite loops
          if (entry.isSymbolicLink && entry.isSymbolicLink()) {continue;}
          
          const fullPath = path.join(dirPath, entry.name);
          
          // Never count our internal metadata folder in decoration totals
          if (entry.isDirectory() && entry.name === '.promptcode') {
            continue;
          }
          
          // Skip ignored files
          if (this.ignoreHelper?.shouldIgnore(fullPath)) {
            continue;
          }
          
          if (entry.isDirectory()) {
            // Recursively count subdirectories
            const subCounts = walk(fullPath);
            total += subCounts.total;
            checked += subCounts.checked;
          } else if (entry.isFile()) {
            total++;
            if (checkedItems.get(fullPath) === vscode.TreeItemCheckboxState.Checked) {
              checked++;
            }
          }
        }
      } catch {
        // Directory not accessible
      }
      
      // Store the counts for this directory
      if (total > 0) {
        this.dirDecorationCache.set(dirPath, { checked, total });
      }
      
      return { total, checked };
    };
    
    // Walk from each workspace root
    for (const rootPath of this.workspaceRoots.values()) {
      walk(rootPath);
    }
  }

  // Incremental update for single file selection changes (performance optimization)
  private updateDecorationCacheForFile(filePath: string, isChecked: boolean): void {
    // Only use incremental updates for single file changes
    // For directory changes or bulk operations, fall back to full rebuild
    
    // Update counts for all parent directories up to workspace root
    let dir = path.dirname(filePath);
    const delta = isChecked ? 1 : -1;
    
    while (dir && dir !== path.dirname(dir)) {
      const entry = this.dirDecorationCache.get(dir);
      if (entry) {
        entry.checked = Math.max(0, Math.min(entry.total, entry.checked + delta));
      }
      
      // Stop at workspace root
      if (Array.from(this.workspaceRoots.values()).includes(dir)) {
        break;
      }
      dir = path.dirname(dir);
    }
  }

  // Trigger decoration updates when selection changes
  private updateDecorations(paths?: string[]): void {
    if (paths && paths.length > 0) {
      // Update decorations for specific paths and their parents
      const uris: vscode.Uri[] = [];
      for (const filePath of paths) {
        uris.push(withDecorQuery(vscode.Uri.file(filePath)));
        // Also update parent directories
        let parentPath = path.dirname(filePath);
        while (parentPath && parentPath !== path.dirname(parentPath)) {
          uris.push(withDecorQuery(vscode.Uri.file(parentPath)));
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