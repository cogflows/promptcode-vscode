import { program } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { spinner } from '../utils/spinner';
import { BUILD_VERSION } from '../version';
import { integrateCommand } from './integrate';
import { getAssetName } from '../utils/assets';
import { isInteractive } from '../utils/environment';

const execAsync = promisify(exec);
const REPO = 'cogflows/promptcode-vscode';
const BASE_URL = process.env.PROMPTCODE_BASE_URL || 'https://api.github.com';

interface GitHubRelease {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(`${BASE_URL}/repos/${REPO}/releases/latest`, {
      signal: controller.signal,
      headers: {
        'User-Agent': `promptcode-cli/${BUILD_VERSION}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function getPlatformBinaryName(): string {
  // Use centralized asset naming
  return getAssetName(process.platform as any, process.arch);
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
  
  const response = await fetch(url, { 
    signal: controller.signal,
    headers: { 'User-Agent': `promptcode-cli/${BUILD_VERSION}` }
  });
  clearTimeout(timeout);
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }
  
  // Validate content type
  const contentType = response.headers.get('content-type');
  if (contentType && (contentType.includes('text/html') || contentType.includes('text/xml'))) {
    throw new Error('Received HTML/XML instead of binary - possible captive portal or error page');
  }
  
  // Check file size (max 100MB)
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
    throw new Error(`File too large: ${contentLength} bytes (max 100MB)`);
  }
  
  const buffer = await response.arrayBuffer();
  
  // Additional size check after download
  if (buffer.byteLength > 100 * 1024 * 1024) {
    throw new Error(`Downloaded file too large: ${buffer.byteLength} bytes`);
  }
  
  // Validate it looks like a binary (not HTML error page)
  const view = new Uint8Array(buffer);
  const header = String.fromCharCode(...view.slice(0, Math.min(20, view.length)));
  if (header.includes('<!DOCTYPE') || header.includes('<html')) {
    throw new Error('Downloaded file appears to be HTML, not a binary');
  }
  
  await fs.writeFile(dest, Buffer.from(buffer));
}

async function getChecksumCommand(filePath: string): Promise<string> {
  if (process.platform === 'win32') {
    // Try certutil first, fallback to PowerShell
    try {
      await execAsync('certutil /?');
      return `certutil -hashfile "${filePath}" SHA256`;
    } catch {
      // Use PowerShell as fallback
      return `powershell -Command "Get-FileHash -Algorithm SHA256 -Path '${filePath}' | Select-Object -ExpandProperty Hash"`;
    }
  } else {
    // Unix-like systems: try sha256sum first, then shasum
    try {
      await execAsync('which sha256sum');
      return `sha256sum "${filePath}"`;
    } catch {
      // macOS typically has shasum
      return `shasum -a 256 "${filePath}"`;
    }
  }
}

async function verifyChecksum(filePath: string, checksumUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(checksumUrl, { 
      signal: controller.signal,
      headers: { 'User-Agent': `promptcode-cli/${BUILD_VERSION}` }
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Checksum file not available (${response.status})`);
    }
    
    // Validate content type
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      throw new Error('Received HTML instead of checksum file - possible captive portal or GitHub error');
    }
    
    const expectedChecksum = (await response.text()).trim().split(/\s+/)[0];
    
    // Calculate actual checksum using detected command
    const checksumCmd = await getChecksumCommand(filePath);
    const { stdout } = await execAsync(checksumCmd);
    
    // Extract hash from output (handles different formats)
    let actualChecksum = stdout.trim();
    if (actualChecksum.includes(' ')) {
      actualChecksum = actualChecksum.split(/\s+/)[0];
    }
    // PowerShell outputs uppercase, normalize to lowercase
    actualChecksum = actualChecksum.toLowerCase();
    
    const isValid = actualChecksum === expectedChecksum.toLowerCase();
    if (!isValid) {
      throw new Error(`Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`);
    }
    
    return true;
  } catch (error) {
    // Checksum verification is MANDATORY for security
    throw new Error(`Checksum verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function replaceBinary(newBinaryPath: string): Promise<void> {
  const currentBinary = process.execPath;
  const dir = path.dirname(currentBinary);
  const stagedPath = path.join(dir, path.basename(currentBinary) + '.new');
  
  // Check if directory is writable before attempting update
  try {
    await fs.access(dir, fs.constants.W_OK);
  } catch (error) {
    throw new Error(`Update directory is not writable: ${dir}\nPlease check permissions or run with appropriate privileges.`);
  }
  
  // Always stage in the same directory to avoid cross-device moves
  await fs.copyFile(newBinaryPath, stagedPath);
  await fs.chmod(stagedPath, 0o755);
  
  // Windows requires special handling - can't replace running executable
  if (process.platform === 'win32') {
    const batchPath = path.join(dir, 'update.bat');
    
    // Create batch script to replace binary after process exits
    // Include retry logic to handle file locks from antivirus or indexers
    const batchContent = `@echo off
setlocal
echo Waiting for PromptCode to exit...
timeout /t 2 /nobreak >nul

rem Retry loop for up to 15 seconds with 1-second delays
set RETRY_COUNT=0
:retry_loop
set /a RETRY_COUNT+=1
if %RETRY_COUNT% GTR 15 goto :failed

move /Y "${stagedPath}" "${currentBinary}" >nul 2>&1
if %ERRORLEVEL% EQU 0 goto :success

rem File might be locked, wait and retry
timeout /t 1 /nobreak >nul
goto :retry_loop

:success
echo Update completed successfully.
"${currentBinary}" --version
goto :cleanup

:failed
echo Update failed after 15 attempts. File may be locked by antivirus or another process.
echo Please manually rename:
echo   From: ${stagedPath}
echo   To: ${currentBinary}
echo.
echo Or try closing all PromptCode instances and running:
echo   move /Y "${stagedPath}" "${currentBinary}"
goto :cleanup

:cleanup
del "%~f0"
`;
    
    await fs.writeFile(batchPath, batchContent);
    
    console.log(chalk.green('\n✓ Update staged successfully'));
    console.log(chalk.cyan('Update will complete automatically in a moment...'));
    
    // Auto-launch the batch file and exit
    const { spawn } = await import('child_process');
    spawn(batchPath, [], {
      detached: true,
      stdio: 'ignore',
      shell: true
    }).unref();
    
    // Exit immediately so the batch script can replace the binary
    process.exit(0);
  }
  
  // On Unix/macOS, also finalize on next run via the startup finalizer
  // This keeps behavior consistent and avoids cross-device rename issues
  console.log(chalk.green('\n✓ Update staged successfully'));
  console.log(chalk.cyan('The update will be applied on next launch'));
}

function isNewerVersion(latest: string, current: string): boolean {
  // Remove 'v' prefix and split into parts
  const latestParts = latest.replace(/^v/, '').split('.').map(Number);
  const currentParts = current.replace(/^v/, '').split('.').map(Number);
  
  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const latestPart = latestParts[i] || 0;
    const currentPart = currentParts[i] || 0;
    
    if (latestPart > currentPart) {return true;}
    if (latestPart < currentPart) {return false;}
  }
  
  return false;
}

export const updateCommand = program
  .command('update')
  .description('Update PromptCode CLI to the latest version')
  .option('--force', 'Force update even if already on latest version')
  .action(async (options) => {
    const spin = spinner();
    
    try {
      // Check if running from npm/development - but allow with --force
      if ((BUILD_VERSION.includes('-dev') || BUILD_VERSION === '0.0.0-dev') && !options.force) {
        console.log(chalk.yellow('⚠ Cannot update development version'));
        console.log('Use --force flag to override:');
        console.log(chalk.cyan('  promptcode update --force'));
        process.exit(1);
      }
      
      spin.start('Checking for updates...');
      
      const release = await fetchLatestRelease();
      if (!release) {
        spin.fail('Could not fetch latest release information');
        process.exit(1);
      }
      
      const latestVersion = release.tag_name;
      
      if (!options.force && !isNewerVersion(latestVersion, BUILD_VERSION)) {
        spin.succeed(`Already on the latest version (${BUILD_VERSION})`);
        return;
      }
      
      spin.text = `Downloading version ${latestVersion}...`;
      
      // Find the right asset for this platform
      const binaryName = getPlatformBinaryName();
      const asset = release.assets.find(a => a.name === binaryName);
      
      if (!asset) {
        spin.fail(`No binary found for platform: ${binaryName}`);
        process.exit(1);
      }
      
      // Download to temp file
      const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'promptcode-update-'));
      const tempBinary = path.join(tempDir, binaryName);
      
      await downloadFile(asset.browser_download_url, tempBinary);
      
      // Verify checksum if available
      spin.text = 'Verifying download...';
      const checksumUrl = `${asset.browser_download_url}.sha256`;
      const isValid = await verifyChecksum(tempBinary, checksumUrl);
      
      if (!isValid) {
        spin.fail('Checksum verification failed');
        await fs.rm(tempDir, { recursive: true });
        process.exit(1);
      }
      
      // Replace the binary
      spin.text = 'Installing update...';
      await replaceBinary(tempBinary);
      
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true });
      
      spin.succeed(`Successfully updated to version ${latestVersion}`);
      console.log(chalk.green('\n✨ Update complete! The new version will be used on the next run.'));
      
      // Check for integration updates only in interactive mode
      if (isInteractive()) {
        console.log(chalk.cyan('\nChecking for integration updates...'));
        await integrateCommand({ 
          autoDetect: true, 
          path: process.cwd(),
          skipModified: true
        });
      }
      
    } catch (error) {
      spin.fail(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });