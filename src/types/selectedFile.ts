/**
 * Represents a file selected by the user, including metadata relevant
 * for prompt generation.
 */
export type SelectedFile = {
	path: string; // Relative path within the workspace folder
	absolutePath: string; // The full, absolute path on the filesystem
	tokenCount: number; // Cached token count for the file content
	workspaceFolderRootPath: string; // Absolute path to the root of the workspace folder containing this file
	workspaceFolderName: string; // Name of the workspace folder containing this file
    content?: string; // Optional: Pre-loaded content for the file
}; 