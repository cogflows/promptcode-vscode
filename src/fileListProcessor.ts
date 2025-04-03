import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IgnoreHelper } from './ignoreHelper';
import { glob } from 'glob'; // Using glob library for more powerful matching

export class FileListProcessor {

    constructor(
        private workspaceRoot: string,
        private ignoreHelper: IgnoreHelper | undefined
    ) {}

    /**
     * Processes the content of a file list to find matching files in the workspace.
     * @param listContent The raw string content from the list file.
     * @returns An object containing absolute paths of matched files and patterns that didn't match.
     */
    public async processList(listContent: string): Promise<{ matchedFiles: Set<string>, unmatchedPatterns: string[] }> {
        const patterns = this.parseListContent(listContent);
        const matchedFiles = new Set<string>();
        const unmatchedPatterns: string[] = [];
        let patternMatchedSomething: boolean;

        for (const pattern of patterns) {
            patternMatchedSomething = false;
            const potentialMatches: string[] = [];

            if (path.isAbsolute(pattern)) {
                // Handle absolute path
                if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) {
                    potentialMatches.push(pattern);
                }
            } else {
                // Handle relative path or glob pattern using glob library
                
                // --- ADDED: Assume recursion for simple patterns ---
                let adjustedPattern = pattern;
                // Check if pattern contains globstars or path separators
                if (!pattern.includes('**') && !/[/\\]/.test(pattern)) {
                    // If it's a simple pattern like *.txt, assume recursive search
                    adjustedPattern = `**/${pattern}`;
                    console.log(`Adjusted simple pattern "${pattern}" to recursive "${adjustedPattern}"`);
                }
                // --- END ADDED ---
                
                // Ensure pattern uses forward slashes for glob compatibility
                const globPattern = adjustedPattern.replace(/\\/g, '/');
                try {
                    // Use glob directly for better pattern support
                    const files = await glob(globPattern, {
                        cwd: this.workspaceRoot,
                        nodir: true, // Match only files, not directories
                        absolute: true, // Return absolute paths
                        dot: true // Include dotfiles
                    });
                    potentialMatches.push(...files);
                } catch (error) {
                    console.error(`Error processing glob pattern "${globPattern}":`, error);
                    // If glob fails, treat as a literal relative path
                    const literalPath = path.join(this.workspaceRoot, pattern);
                     if (fs.existsSync(literalPath) && fs.statSync(literalPath).isFile()) {
                        potentialMatches.push(literalPath);
                    }
                }
            }

            // Filter matches based on ignore rules and existence
            for (const potentialMatch of potentialMatches) {
                 const absolutePath = path.resolve(potentialMatch); // Ensure it's absolute
                if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
                    if (!this.ignoreHelper || !this.ignoreHelper.shouldIgnore(absolutePath)) {
                        matchedFiles.add(absolutePath);
                        patternMatchedSomething = true;
                    } else {
                         console.log(`Pattern '${pattern}' matched ignored file: ${absolutePath}`);
                    }
                } else {
                     console.log(`Pattern '${pattern}' matched non-existent/non-file: ${absolutePath}`);
                }
            }

            if (!patternMatchedSomething) {
                unmatchedPatterns.push(pattern);
            }
        }

        return { matchedFiles, unmatchedPatterns };
    }

    /**
     * Parses the raw list content into individual patterns.
     * Handles newline, comma, and space delimiters.
     * @param listContent Raw string content.
     * @returns An array of patterns.
     */
    private parseListContent(listContent: string): string[] {
        return listContent
            .split(/[\n, ]+/) // Split by newline, comma, or space(s)
            .map(item => item.trim())
            .filter(item => item !== ''); // Remove empty items
    }
}