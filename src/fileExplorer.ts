import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IgnoreHelper } from './ignoreHelper';

// Map to keep track of checked items
export const checkedItems = new Map<string, boolean>();
// Map to track expanded nodes
export const expandedItems = new Map<string, boolean>();

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
    this.checkboxState = checkedItems.get(fullPath) ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;

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
  }
}


export class FileExplorerProvider implements vscode.TreeDataProvider<FileItem> {
  // ... (existing properties remain the same) ...
  private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null | void> = new vscode.EventEmitter<FileItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null | void> = this._onDidChangeTreeData.event;
  private searchTerm: string = '';
  private cachedEntries: Map<string, fs.Dirent[]> = new Map();
  private _treeView: vscode.TreeView<FileItem> | undefined;
  private disposables: vscode.Disposable[] = [];
  private ignoreHelper: IgnoreHelper | undefined;
  private workspaceRoots: Map<string, string> = new Map(); // Uri string -> fsPath
  private includedPaths: Set<string> = new Set();

  // --- ADDED: Simple Glob to Regex Converter ---
  private globToRegex(pattern: string): RegExp | null {
    if (!pattern || !pattern.trim()) {
      return null;
    }
    // Escape regex special characters, except for *, ?, and potentially others if needed
    const escapedPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&'); 
    // Convert glob * and ? to regex equivalents
    const regexString = escapedPattern
        .replace(/\*/g, '.*')   // Convert * to .* (match any sequence)
        .replace(/\?/g, '.');    // Convert ? to . (match any single char)
    
    try {
      // Anchor the pattern and make it case-insensitive
      return new RegExp(`^${regexString}$`, 'i');
    } catch (e) {
      console.error(`Invalid regex generated from glob pattern: ${pattern}`, e);
      return null; // Invalid pattern
    }
  }
  // --- END ADDED ---

  constructor() {
    // ... (constructor initialization remains the same) ...
    this.initializeWorkspaceRoots();

    // Initialize the ignore helper
    this.ignoreHelper = new IgnoreHelper();
    this.ignoreHelper.initialize().then(() => {
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
      vscode.workspace.onDidCreateFiles(() => this.refresh()),
      vscode.workspace.onDidDeleteFiles(() => this.refresh()),
      vscode.workspace.onDidRenameFiles(() => this.refresh())
    );
  }

  // --- ADDED ---
  /**
   * Provides access to the initialized IgnoreHelper instance.
   */
  public getIgnoreHelper(): IgnoreHelper | undefined {
      return this.ignoreHelper;
  }

  /**
   * Programmatically sets the checked state for a list of absolute file paths.
   * This will ADD to the current selection.
   * @param absoluteFilePaths An array or Set of absolute file paths to check.
   */
  public async setCheckedItems(absoluteFilePaths: Set<string> | string[]): Promise<void> {
      const pathsToAdd = new Set(absoluteFilePaths);
      console.log(`Programmatically adding ${pathsToAdd.size} items to selection.`);
      const parentsToUpdate = new Set<string>();

      // 1. Iterate through the paths to add
      for (const filePath of pathsToAdd) {
          // Check if already checked
          if (checkedItems.get(filePath) === true) {
              console.log(`Skipping already checked file: ${filePath}`);
              continue;
          }
          
          // Double-check if the file still exists before marking it checked
          try {
              const stats = await fs.promises.stat(filePath);
              if (stats.isFile()) {
                    // Also check if it should be ignored NOW (rules might have changed)
                    if (!this.ignoreHelper || !this.ignoreHelper.shouldIgnore(filePath)) {
                       checkedItems.set(filePath, true);
                       parentsToUpdate.add(path.dirname(filePath)); // Mark parent for update
                       console.log(`Added file to selection: ${filePath}`);
                    } else {
                        console.warn(`File specified in list is ignored: ${filePath}`);
                    }
              } else {
                 console.warn(`Path specified in list is not a file or does not exist: ${filePath}`);
              }
          } catch (error) {
                // File likely doesn't exist anymore
                console.warn(`Error stating file from list, skipping: ${filePath}`, error);
          }
      }

       // 2. Update parent states for all newly added files
        const parentUpdatePromises: Promise<void>[] = [];
        for (const parentDir of parentsToUpdate) {
            parentUpdatePromises.push(this.updateParentChain(parentDir));
        }
        // Wait for all parent updates to complete
        if (parentUpdatePromises.length > 0) {
            await Promise.all(parentUpdatePromises);
        }

      // 3. Refresh the tree view to reflect changes
      this.refresh();

      // 4. Update the webview's selected files list
      vscode.commands.executeCommand('promptcode.getSelectedFiles');
      console.log(`Finished adding checked items. Map size: ${checkedItems.size}`);
  }
  // --- END ADDED ---

  // ... (rest of the FileExplorerProvider class remains the same) ...
  private initializeWorkspaceRoots(): void {
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
          this.refresh();
        }
      }),
      fileWatcher.onDidDelete((uri) => {
        const fileName = path.basename(uri.fsPath);
        if (fileName === '.gitignore' || fileName === '.promptcode_ignore') {
          this.refreshIgnoreHelper();
        } else {
          this.refresh();
        }
      }),
      fileWatcher.onDidChange((uri) => {
        const fileName = path.basename(uri.fsPath);
        if (fileName === '.gitignore' || fileName === '.promptcode_ignore') {
          this.refreshIgnoreHelper();
        } else {
          this.refresh(); // Refresh on general file changes too
        }
      })
    );
  }

  // Method to dispose watchers when extension is deactivated
  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
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

  // Method to refresh the ignore helper
  refreshIgnoreHelper(): void {
    if (this.ignoreHelper) {
      this.ignoreHelper.initialize().then(() => {
        // After ignore patterns are reloaded, clean up any selected files that are now ignored
        this.cleanupSelectedFiles();
        this.refresh();
      }).catch(error => {
        console.error('Error refreshing ignore helper:', error);
      });
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
  async setSearchTerm(term: string): Promise<void> {
    console.log(`FileExplorer: Setting search term to "${term}"`);

    const previousTerm = this.searchTerm;
    this.searchTerm = term;

    if (term.trim() !== '') {
      // When searching, first build the search paths
      await this.rebuildSearchPaths(); // Wait for this to complete

      // Then refresh the tree to show matching items
      this.refresh();

      // After refreshing, expand all matching directories
      // Small delay to ensure the tree has updated with search results
      setTimeout(() => {
        if (this._treeView) {
          this.expandMatchingDirectories().catch(error => {
            console.error('Error expanding search matches:', error);
          });
        }
      }, 100);
    } else {
      // Clear the included paths when search is cleared for better performance
      this.includedPaths.clear();

      // Full refresh when clearing search
      this.refresh();
    }
  }


  // First stage of search: find all matches and build path inclusion set
  private async rebuildSearchPaths(): Promise<void> {
    console.log(`FileExplorer: Rebuilding search paths for "${this.searchTerm}"`);
    this.includedPaths.clear();

    if (!this.searchTerm.trim()) {
      return; // No search term, no filtering
    }

    // Function to collect all matches in a directory
    const findMatchesInDirectory = async (dirPath: string): Promise<string[]> => {
      const matches: string[] = [];
      // --- ADDED: Convert search term to regex ---
      const searchRegex = this.globToRegex(this.searchTerm);
      const searchTermLower = this.searchTerm.toLowerCase(); // For fallback
      // --- END ADDED ---

      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          // Skip ignored files
          const fullPath = path.join(dirPath, entry.name);
          if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath)) {
            continue;
          }

          // Check if this entry matches
          // --- MODIFIED: Use Regex or fallback to substring ---
          let isMatch = false;
          if (searchRegex) {
              isMatch = searchRegex.test(entry.name);
          } else if (searchTermLower) { // Fallback only if term exists
              isMatch = entry.name.toLowerCase().includes(searchTermLower);
          }
          // --- END MODIFIED ---
          
          if (isMatch) {
            matches.push(fullPath);
          }

          // Recurse into directories
          if (entry.isDirectory()) {
            // Check if directory is effectively empty
            const isEmpty = await this.isDirectoryEffectivelyEmpty(fullPath);
            if (!isEmpty) {
              const subMatches = await findMatchesInDirectory(fullPath);
              matches.push(...subMatches);
            }
          }
        }
      } catch (error) {
        // Ignore errors like permission denied
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'EACCES' && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error(`Error finding matches in ${dirPath}:`, error);
        }
      }

      return matches;
    };

    // Find all matches in all workspace roots
    const allMatches: string[] = [];
    for (const rootPath of this.workspaceRoots.values()) {
      const matches = await findMatchesInDirectory(rootPath);
      allMatches.push(...matches);
    }

    console.log(`FileExplorer: Found ${allMatches.length} direct matches`);

    // Add all matches to included paths
    for (const matchPath of allMatches) {
      this.includedPaths.add(matchPath);

      // Add all ancestors
      let currentPath = matchPath;
      while (currentPath !== path.dirname(currentPath) && this.workspaceRoots.has(vscode.Uri.file(currentPath).toString())) { // Stop at workspace root or filesystem root
          this.includedPaths.add(currentPath); // Add current path
          const parentPath = path.dirname(currentPath);
          if (parentPath === currentPath) break; // Avoid infinite loop at root
          currentPath = parentPath; // Move to parent
      }


      // For directory matches, add all descendants (will be handled later during tree traversal)
      try {
        const stats = await fs.promises.stat(matchPath);
        if (stats.isDirectory()) {
          // Mark this as a directory match to include all its children
          this.includedPaths.add(`${matchPath}:DIR_MATCH`);
        }
      } catch (error) {
        // Ignore errors (file might have been deleted)
      }
    }

    console.log(`FileExplorer: Built inclusion set with ${this.includedPaths.size} paths`);
  }

  // Check if an item should be included in search results based on the inclusion set
  private shouldIncludeInSearch(fullPath: string, isDirectory: boolean): boolean {
    // No search term, include everything
    if (!this.searchTerm.trim()) {
      return true;
    }

    // Always include the item if its path is directly in the inclusion set
    if (this.includedPaths.has(fullPath)) {
      return true;
    }

    // Check if any parent directory is a matched directory
    // If so, include all its children
    let currentPath = path.dirname(fullPath);
    while (currentPath !== path.dirname(currentPath) && this.workspaceRoots.has(vscode.Uri.file(currentPath).toString())) {
      if (this.includedPaths.has(`${currentPath}:DIR_MATCH`)) {
        return true;
      }
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) break;
      currentPath = parentPath;
    }


    return false;
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
          return this.shouldIncludeInSearch(fullPath, entry.isDirectory());
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
          fileItem.checkboxState = checkedItems.get(fullPath)
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked;
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
        fileItem.checkboxState = checkedItems.get(fullPath)
          ? vscode.TreeItemCheckboxState.Checked
          : vscode.TreeItemCheckboxState.Unchecked;
      }

      return fileItem;
    });
  }

  // Handle checkbox state changes
  handleCheckboxToggle(item: FileItem, checkboxState: vscode.TreeItemCheckboxState): void {
    const isChecked = checkboxState === vscode.TreeItemCheckboxState.Checked;

    // Block to prevent nested async operations from causing race conditions
    this.processCheckboxChange(item, isChecked).then(() => {
      // Refresh the specific item and its parents instead of full refresh
        this._onDidChangeTreeData.fire(item); // Refresh the item itself
        let parentPath = path.dirname(item.fullPath);
        while(parentPath !== item.fullPath && parentPath !== path.dirname(parentPath)) { // Stop at root
            this.getParent(item).then(parent => { // Need to get parent FileItem to refresh
                if(parent) this._onDidChangeTreeData.fire(parent);
            });
             parentPath = path.dirname(parentPath);
        }


      // Notify the webview about the change in selected files
      vscode.commands.executeCommand('promptcode.getSelectedFiles');
    }).catch(error => {
      console.error("Error processing checkbox change:", error);
      this.refresh(); // Full refresh on error
    });
  }

  // Process checkbox changes synchronously to avoid race conditions
  private async processCheckboxChange(item: FileItem, isChecked: boolean): Promise<void> {
    // Step 1: Update the current item's state
    checkedItems.set(item.fullPath, isChecked);

    // Step 2: If it's a directory, update all children
    if (item.isDirectory) {
      await this.setAllChildrenState(item.fullPath, isChecked);
    }

    // Step 3: Update all parent directories up to the root
    await this.updateParentChain(path.dirname(item.fullPath));
  }

  // Set checkbox state for all children (simplifying previous methods)
  private async setAllChildrenState(dirPath: string, isChecked: boolean): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip ignored items
        if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath)) {
          continue;
        }

        // Set the state
        checkedItems.set(fullPath, isChecked);

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
          // No visible children means indeterminate state or unchecked if previously set
          // Let's default to unchecked unless it was explicitly checked before (which shouldn't happen for empty dir)
          if (checkedItems.has(dirPath)) { // Only modify if it exists in the map
             checkedItems.set(dirPath, false);
          }
      } else if (childStates.every(state => state === false)) {
        // All children unchecked -> parent unchecked
        checkedItems.set(dirPath, false);
      } else {
        // Any child is checked -> parent checked
        checkedItems.set(dirPath, true);
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
  private async getChildrenStates(dirPath: string): Promise<boolean[]> {
    // Return empty array if path is empty
    if (!dirPath || dirPath === '') {
      console.warn('Empty directory path passed to getChildrenStates');
      return [];
    }

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const states: boolean[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip ignored items
        if (this.ignoreHelper && this.ignoreHelper.shouldIgnore(fullPath)) {
          continue;
        }

        // Add the state to our collection
        const state = checkedItems.get(fullPath) || false;
        states.push(state);
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

          checkedItems.set(fullPath, checked);

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
      checkedItems.set(rootPath, checked);
      await processDirectory(rootPath);
    }

    this.refresh();

    // Notify the webview about the change in selected files
    vscode.commands.executeCommand('promptcode.getSelectedFiles');
  }

  // Method to expand directories that match the search
  private async expandMatchingDirectories(): Promise<void> {
    if (!this._treeView) {
      return;
    }

    console.log('Expanding directories that match search criteria');

    try {
      // First get all the directories present in the current view (respecting search filter)
      const directories = await this.getAllDirectories(); // This already respects ignore filters
      console.log(`Found ${directories.length} potentially visible directories to check for expansion`);

      // Filter directories based on whether they or their ancestors are in the includedPaths set
      const directoriesToExpand = directories.filter(dir => {
         // Check if the directory itself or any of its ancestors are in the inclusion set
         let currentPath = dir.fullPath;
         while (currentPath && currentPath !== path.dirname(currentPath) && this.workspaceRoots.has(vscode.Uri.file(currentPath).toString())) {
            if (this.includedPaths.has(currentPath) || this.includedPaths.has(`${currentPath}:DIR_MATCH`)) {
                return true; // Expand if the directory or an ancestor matches
            }
             const parentPath = path.dirname(currentPath);
             if (parentPath === currentPath) break;
             currentPath = parentPath;
         }
         return false;
      });


      console.log(`Will expand ${directoriesToExpand.length} directories relevant to search matches`);


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
      };


      const batchSize = 50; // Process 50 directories at a time
       for (let i = 0; i < directoriesToExpand.length; i += batchSize) {
            const batch = directoriesToExpand.slice(i, i + batchSize);
            console.log(`Expanding search match batch ${i / batchSize + 1}...`);
            await revealBatch(batch);
            await delay(100); // Small delay between batches
       }


      console.log('Expansion for search matches completed.');
    } catch (error) {
      console.error('Error expanding matching directories:', error);
    }
  }
}