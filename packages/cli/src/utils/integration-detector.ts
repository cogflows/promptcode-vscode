import { findClaudeFolder } from './claude-integration';
import { findCursorFolder, findCursorRulesFile } from './cursor-integration';

export interface IntegrationStatus {
  claude: {
    detected: boolean;
    path: string | null;
  };
  cursor: {
    detected: boolean;
    path: string | null;
    hasLegacyRules: boolean;
  };
}

/**
 * Detect AI environment integrations in the project
 */
export async function detectIntegrations(projectPath: string): Promise<IntegrationStatus> {
  const claudeFolder = findClaudeFolder(projectPath);
  const cursorFolder = findCursorFolder(projectPath);
  const cursorRulesFile = findCursorRulesFile(projectPath);
  
  return {
    claude: {
      detected: claudeFolder !== null,
      path: claudeFolder
    },
    cursor: {
      detected: cursorFolder !== null || cursorRulesFile !== null,
      path: cursorFolder || cursorRulesFile,
      hasLegacyRules: cursorRulesFile !== null && cursorFolder === null
    }
  };
}

/**
 * Check if any integrations are available
 */
export function hasAnyIntegration(status: IntegrationStatus): boolean {
  return status.claude.detected || status.cursor.detected;
}