import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ignore from 'ignore';
import { DEFAULT_IGNORE_PATTERNS } from './constants';

/**
 * Helper class to handle ignore patterns from both .promptcode_ignore and .gitignore files
 */
export class IgnoreHelper {
    private promptcodeIgnores: Map<string, ignore.Ignore> = new Map(); // workspaceRoot -> ignore
    private gitignores: Map<string, ignore.Ignore> = new Map(); // directory -> ignore
    private workspaceRoots: Map<string, string> = new Map(); // Uri string -> fsPath
    private respectGitignore: boolean = true;

    constructor() {
        this.initializeWorkspaceRoots();
    }

    /**
     * Initialize workspace roots from VSCode API
     */
    private initializeWorkspaceRoots(): void {
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                this.workspaceRoots.set(folder.uri.toString(), folder.uri.fsPath);
            }
        }
    }

    /**
     * Initialize the ignore helper by loading all relevant ignore files
     */
    public async initialize(): Promise<void> {
        // Always re-snapshot workspace roots from VS Code
        this.workspaceRoots.clear();
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                this.workspaceRoots.set(folder.uri.toString(), folder.uri.fsPath);
            }
        }
        
        // Load the respectGitignore setting
        const config = vscode.workspace.getConfiguration('promptcode');
        this.respectGitignore = config.get('respectGitignore', true);
        
        // Process each workspace root
        for (const workspaceRoot of this.workspaceRoots.values()) {
            await this.initializeForWorkspace(workspaceRoot);
        }
    }

    /**
     * Initialize ignore patterns for a specific workspace
     */
    public async initializeForWorkspace(workspaceRoot: string): Promise<void> {
        await this.loadPromptcodeIgnore(workspaceRoot);
        
        if (this.respectGitignore) {
            await this.findAllGitignores(workspaceRoot);
        }
    }

    /**
     * Load .promptcode_ignore file from workspace root
     */
    private async loadPromptcodeIgnore(workspaceRoot: string): Promise<void> {
        const ignoreFilePath = path.join(workspaceRoot, '.promptcode_ignore');
        
        try {
            // Check if the file exists
            await fs.promises.access(ignoreFilePath);
            
            // Read and parse the file
            const content = await fs.promises.readFile(ignoreFilePath, 'utf8');
            this.promptcodeIgnores.set(workspaceRoot, ignore.default().add(content));
            console.log(`.promptcode_ignore found at ${workspaceRoot}, using custom patterns`);
        } catch (error) {
            // File doesn't exist or can't be read, use default patterns
            console.log(`.promptcode_ignore file not found for workspace ${workspaceRoot}, using default patterns`);
            this.promptcodeIgnores.set(workspaceRoot, ignore.default().add(DEFAULT_IGNORE_PATTERNS));
        }
    }

    /**
     * Find all .gitignore files in the workspace
     */
    private async findAllGitignores(workspaceRoot: string): Promise<void> {
        // Clear existing gitignores for this workspace
        // We can't do this for all gitignores as there might be multiple workspaces
        for (const [dir, _] of [...this.gitignores.entries()]) {
            if (dir.startsWith(workspaceRoot)) {
                this.gitignores.delete(dir);
            }
        }
        
        const findGitignores = async (dir: string): Promise<void> => {
            try {
                const gitignorePath = path.join(dir, '.gitignore');
                
                // Check if .gitignore exists in this directory
                try {
                    await fs.promises.access(gitignorePath);
                    await this.loadGitignore(gitignorePath, dir);
                } catch (error) {
                    // .gitignore doesn't exist in this directory, continue with subdirectories
                }
                
                // Process subdirectories
                const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                const subdirs = entries
                    .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git')
                    .map(entry => path.join(dir, entry.name));
                
                // Process each subdirectory
                for (const subdir of subdirs) {
                    await findGitignores(subdir);
                }
            } catch (error) {
                console.error(`Error finding .gitignore files in ${dir}:`, error);
            }
        };
        
        await findGitignores(workspaceRoot);
    }

    /**
     * Load and parse a .gitignore file
     */
    private async loadGitignore(gitignorePath: string, dir: string): Promise<void> {
        try {
            const content = await fs.promises.readFile(gitignorePath, 'utf8');
            this.gitignores.set(dir, ignore.default().add(content));
        } catch (error) {
            console.error(`Error loading .gitignore at ${gitignorePath}:`, error);
        }
    }

    /**
     * Check if a file should be ignored based on the loaded ignore patterns
     * @param filePath The path to check
     * @param isDirHint Optional hint about whether the path is a directory (avoids stat call)
     */
    public shouldIgnore(filePath: string, isDirHint?: boolean): boolean {
        if (!filePath || filePath.trim() === '') {
            return false; // Can't ignore an empty path
        }
        
        // Find which workspace root this file belongs to by checking our stored roots
        let workspaceRoot: string | undefined;
        for (const root of this.workspaceRoots.values()) {
            if (filePath.startsWith(root)) {
                workspaceRoot = root;
                break;
            }
        }
        
        if (!workspaceRoot) {
            return false; // File is not in any workspace root
        }
        
        // Get relative path to the workspace root
        let relativePath = '';
        if (filePath.startsWith(workspaceRoot)) {
            relativePath = filePath.substring(workspaceRoot.length);
        }
        relativePath = relativePath.replace(/^[\/\\]/, ''); // Remove leading slash
        
        // If after processing we have an empty relative path, return false
        if (relativePath === '') {
            return false;
        }
        
        // Check promptcode_ignore for this workspace
        const promptcodeIgnore = this.promptcodeIgnores.get(workspaceRoot);
        
        
        if (promptcodeIgnore) {
            // For directories, also check with trailing slash for patterns like "docs/"
            // Use the hint if provided, otherwise assume it's a file
            const isDir = isDirHint ?? false;
            if (promptcodeIgnore.ignores(relativePath) || (isDir && promptcodeIgnore.ignores(relativePath + '/'))) {
                return true;
            }
        }
        
        // Check gitignore patterns
        if (this.respectGitignore) {
            // Find the most specific .gitignore that applies to this file
            let currentDir = path.dirname(filePath);
            while (currentDir && currentDir !== '' && currentDir.startsWith(workspaceRoot)) {
                const gitignore = this.gitignores.get(currentDir);
                if (gitignore) {
                    const relativeToGitignore = path.relative(currentDir, filePath);
                    if (relativeToGitignore !== '') {
                        // For directories, also check with trailing slash
                        // Use the hint if provided, otherwise assume it's a file
                        const isDir = isDirHint ?? false;
                        if (gitignore.ignores(relativeToGitignore) || (isDir && gitignore.ignores(relativeToGitignore + '/'))) {
                            return true;
                        }
                    }
                }
                // Move up to parent directory
                const parentDir = path.dirname(currentDir);
                if (parentDir === currentDir) {
                    break; // Reached root
                }
                currentDir = parentDir;
            }
        }
        
        return false;
    }
} 