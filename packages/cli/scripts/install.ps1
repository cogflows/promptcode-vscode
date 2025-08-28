# PromptCode CLI Installer for Windows
# https://github.com/cogflows/promptcode-vscode
#
# Usage:
#   irm https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.ps1 | iex
#   or
#   Invoke-WebRequest ... | Invoke-Expression

param(
    [switch]$Uninstall,
    [switch]$Insecure,
    [switch]$NoPathChanges,
    [switch]$NonInteractive
)

# Configuration
$REPO = "cogflows/promptcode-vscode"
$CLI_NAME = "promptcode"
$DEFAULT_INSTALL_DIR = "$env:LOCALAPPDATA\PromptCode\bin"
$INSTALL_DIR = if ($env:PROMPTCODE_INSTALL_DIR) { $env:PROMPTCODE_INSTALL_DIR } else { $DEFAULT_INSTALL_DIR }

# Helper functions
function Test-NonInteractive {
    # Check for explicit non-interactive flag
    if ($NonInteractive) {
        return $true
    }
    
    # Check for CI/CD environment
    if ($env:CI -eq 'true' -or $env:TF_BUILD -eq 'True' -or $env:GITHUB_ACTIONS -eq 'true') {
        return $true
    }
    
    # Check if input is redirected (running via pipe or script)
    if ([Console]::IsInputRedirected) {
        return $true
    }
    
    # Check if running in a non-interactive session
    if (-not [Environment]::UserInteractive) {
        return $true
    }
    
    return $false
}

function Write-Info($message) {
    Write-Host "[INFO] " -ForegroundColor Blue -NoNewline
    Write-Host $message
}

function Write-Success($message) {
    Write-Host "[SUCCESS] " -ForegroundColor Green -NoNewline
    Write-Host $message
}

function Write-Warning($message) {
    Write-Host "[WARNING] " -ForegroundColor Yellow -NoNewline
    Write-Host $message
}

function Write-Error($message) {
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $message
    exit 1
}

# Detect architecture
function Get-Architecture {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq "ARM64") {
        return "arm64"
    } elseif ($arch -eq "AMD64") {
        return "x64"
    } else {
        Write-Error "Unsupported Windows architecture: $arch"
    }
}

# Fetch latest version from GitHub
function Get-LatestVersion {
    # Allow override via environment variable for testing
    if ($env:PROMPTCODE_TEST_VERSION) {
        Write-Info "Using test version: $($env:PROMPTCODE_TEST_VERSION)"
        return $env:PROMPTCODE_TEST_VERSION
    }
    
    Write-Info "Fetching latest version..."
    
    try {
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest"
        $version = $releases.tag_name
        Write-Info "Latest version: $version"
        return $version
    }
    catch {
        # Try fallback to releases/latest redirect
        Write-Warning "GitHub API request failed, trying fallback method..."
        try {
            $response = Invoke-WebRequest -Uri "https://github.com/$REPO/releases/latest" -MaximumRedirection 0 -ErrorAction SilentlyContinue
        }
        catch {
            if ($_.Exception.Response.StatusCode -eq 302) {
                $redirectUrl = $_.Exception.Response.Headers.Location.ToString()
                if ($redirectUrl -match '/tag/([^/]+)$') {
                    $version = $matches[1]
                    Write-Info "Latest version (via redirect): $version"
                    return $version
                }
            }
        }
        Write-Error "Could not fetch latest version. Check your internet connection."
    }
}

# Download binary
function Download-Binary($version, $arch) {
    $binaryName = "${CLI_NAME}-win-${arch}.exe"
    $downloadUrl = "https://github.com/$REPO/releases/download/$version/$binaryName"
    $checksumUrl = "https://github.com/$REPO/releases/download/$version/$binaryName.sha256"
    $tempFile = [System.IO.Path]::GetTempFileName() + ".exe"
    
    Write-Info "Downloading $CLI_NAME $version for Windows $arch..."
    
    try {
        # Download the binary
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing
        
        # Download and verify checksum
        Write-Info "Verifying checksum..."
        try {
            $expectedChecksum = (Invoke-WebRequest -Uri $checksumUrl -UseBasicParsing).Content.Trim().Split()[0]
            $actualChecksum = (Get-FileHash -Path $tempFile -Algorithm SHA256).Hash.ToLower()
            
            if ($actualChecksum -ne $expectedChecksum.ToLower()) {
                Remove-Item $tempFile -Force
                Write-Error "Checksum verification failed. Expected: $expectedChecksum, Got: $actualChecksum"
            }
            
            Write-Success "Checksum verified successfully"
        }
        catch {
            if (-not $Insecure) {
                Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
                Write-Error "Checksum verification unavailable. Re-run with -Insecure to override (NOT RECOMMENDED)."
            } else {
                Write-Warning "SECURITY WARNING: Checksum verification failed or unavailable."
                Write-Warning "Installing without verification is risky and could compromise your system."
                
                if (Test-NonInteractive) {
                    # In CI/non-interactive mode with -Insecure flag, allow bypass for testing
                    if ($env:CI -eq "true") {
                        Write-Warning "CI environment detected - proceeding with -Insecure flag for testing purposes."
                    } else {
                        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
                        Write-Error "Cannot proceed with -Insecure in non-interactive mode. Please verify checksums are available or run interactively."
                    }
                } else {
                    # Interactive mode - prompt for confirmation
                    Write-Host ""
                    $response = Read-Host "Are you SURE you want to proceed without checksum verification? [y/N]"
                    if ($response -notmatch '^[Yy]') {
                        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
                        Write-Error "Installation cancelled for security reasons."
                    }
                    Write-Warning "Proceeding without checksum verification at your own risk."
                }
            }
        }
        
        return $tempFile
    }
    catch {
        Write-Error "Failed to download from: $downloadUrl"
    }
}

# Install binary
function Install-Binary($sourcePath) {
    # Create installation directory
    if (!(Test-Path $INSTALL_DIR)) {
        New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
    }
    
    $targetPath = Join-Path $INSTALL_DIR "${CLI_NAME}.exe"
    
    # Copy binary
    Copy-Item -Path $sourcePath -Destination $targetPath -Force
    Remove-Item $sourcePath -Force
    
    Write-Success "$CLI_NAME installed to $targetPath"
    return $targetPath
}

# Add to PATH
function Update-Path {
    if ($NoPathChanges) {
        Write-Info "Skipping PATH modification due to -NoPathChanges flag"
        Write-Info "To add to PATH manually, run:"
        Write-Host "  [Environment]::SetEnvironmentVariable('Path', `$env:Path + ';$INSTALL_DIR', 'User')" -ForegroundColor Yellow
        return
    }
    
    # In non-interactive mode, skip PATH changes by default
    if (Test-NonInteractive) {
        Write-Info "Non-interactive mode detected - skipping PATH modification"
        Write-Info "To add to PATH manually, run:"
        Write-Host "  [Environment]::SetEnvironmentVariable('Path', `$env:Path + ';$INSTALL_DIR', 'User')" -ForegroundColor Yellow
        return
    }
    
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    
    if ($currentPath -notlike "*$INSTALL_DIR*") {
        # Prompt for PATH modification
        Write-Host ""
        $response = Read-Host "Add $INSTALL_DIR to your user PATH? [Y/n]"
        if ($response -match '^[Nn]') {
            Write-Info "PATH not modified. To add to PATH manually, run:"
            Write-Host "  [Environment]::SetEnvironmentVariable('Path', `$env:Path + ';$INSTALL_DIR', 'User')" -ForegroundColor Yellow
            return
        }
        
        Write-Info "Adding $INSTALL_DIR to PATH..."
        
        $newPath = "$currentPath;$INSTALL_DIR"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        
        # Update current session
        $env:Path = "$env:Path;$INSTALL_DIR"
        
        Write-Success "PATH updated successfully"
        Write-Warning "You may need to restart your terminal for PATH changes to take effect"
    }
    else {
        Write-Info "$INSTALL_DIR is already in PATH"
    }
}

# Detect Claude Code environment
function Test-ClaudeCode {
    $currentDir = Get-Location
    
    # Check for CLAUDE_PROJECT_DIR environment variable
    if ($env:CLAUDE_PROJECT_DIR) {
        Write-Info "Claude Code environment detected (via CLAUDE_PROJECT_DIR)"
        return $true
    }
    
    # Search for .claude folder
    $testPath = $currentDir
    for ($i = 0; $i -lt 5; $i++) {
        $claudePath = Join-Path $testPath ".claude"
        if (Test-Path $claudePath) {
            Write-Info "Claude Code project detected at: $testPath"
            return $true
        }
        $parent = Split-Path $testPath -Parent
        if (!$parent -or $parent -eq $testPath) {
            break
        }
        $testPath = $parent
    }
    
    return $false
}

# Uninstall function
function Uninstall-PromptCode {
    Write-Info "Uninstalling $CLI_NAME..."
    
    $binaryPath = Join-Path $INSTALL_DIR "${CLI_NAME}.exe"
    
    if (Test-Path $binaryPath) {
        Remove-Item $binaryPath -Force
        Write-Success "Removed binary: $binaryPath"
    }
    else {
        Write-Warning "Binary not found at $binaryPath"
    }
    
    # Ask about cache and config (skip in non-interactive mode)
    $removeData = $false
    if (Test-NonInteractive) {
        Write-Info "Non-interactive mode - keeping configuration and cache files"
    } else {
        $response = Read-Host "Remove configuration and cache files? [y/N]"
        $removeData = ($response -eq 'y' -or $response -eq 'Y')
    }
    
    if ($removeData) {
        $configDir = "$env:APPDATA\promptcode"
        $cacheDir = "$env:LOCALAPPDATA\promptcode\cache"
        
        if (Test-Path $configDir) {
            Remove-Item $configDir -Recurse -Force
            Write-Success "Removed config: $configDir"
        }
        
        if (Test-Path $cacheDir) {
            Remove-Item $cacheDir -Recurse -Force
            Write-Success "Removed cache: $cacheDir"
        }
    }
    
    # Remove from PATH (normalize paths for comparison)
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -like "*$INSTALL_DIR*") {
        # Normalize paths by trimming trailing slashes and comparing case-insensitively
        $installDirNorm = $INSTALL_DIR.TrimEnd('\').ToLower()
        $pathParts = $currentPath -split ';' | Where-Object {
            $_.TrimEnd('\').ToLower() -ne $installDirNorm
        }
        $newPath = $pathParts -join ';'
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Success "Removed from PATH"
    }
    
    Write-Success "Uninstall complete"
}

# Main installation flow
function Install-PromptCode {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║     PromptCode CLI Installer        ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    
    # Detect architecture
    $arch = Get-Architecture
    Write-Info "Detected architecture: $arch"
    
    # Get latest version first
    $version = Get-LatestVersion
    
    # Check if already installed
    $existingPath = Get-Command $CLI_NAME -ErrorAction SilentlyContinue
    if ($existingPath) {
        try {
            $currentVersion = & $CLI_NAME --version 2>$null
            Write-Info "$CLI_NAME is already installed (version: $currentVersion)"
        } catch {
            Write-Info "$CLI_NAME is already installed"
        }
        Write-Info "Latest version available: $version"
        
        # Check if it's a development version
        if ($currentVersion -like "*-dev.*") {
            Write-Warning "You're running a development version"
        }
        
        # Check if update command exists
        try {
            & $CLI_NAME update --help 2>$null | Out-Null
            
            # For dev versions, inform about --force option
            if ($currentVersion -like "*-dev.*") {
                Write-Info "Development version detected. To force update to ${version}:"
                Write-Host ""
                Write-Host "  $CLI_NAME update --force" -ForegroundColor Cyan
                Write-Host ""
                
                if (Test-NonInteractive) {
                    Write-Info "Running in non-interactive mode - skipping auto-update"
                    Write-Info "You can run the command manually later"
                    exit 0
                }
                
                $response = Read-Host "Run this command now? [Y/n]"
                if ($response -ne 'n' -and $response -ne 'N') {
                    & $CLI_NAME update --force
                    exit $LASTEXITCODE
                } else {
                    Write-Info "You can run the command manually later"
                    exit 0
                }
            } else {
                Write-Info "Using built-in update to upgrade..."
                Write-Host ""
                & $CLI_NAME update
                exit $LASTEXITCODE
            }
        } catch {
            # Older version without update
            if ($currentVersion -like "*-dev.*") {
                Write-Warning "This development version doesn't support update."
                Write-Info "Will force reinstall with latest release version ($version)"
                
                if (Test-NonInteractive) {
                    Write-Info "Running in non-interactive mode - proceeding with force reinstall"
                } else {
                    $response = Read-Host "Proceed with force reinstall? [Y/n]"
                    if ($response -eq 'n' -or $response -eq 'N') {
                        Write-Info "Installation cancelled"
                        exit 0
                    }
                }
                # Continue with installation - will overwrite the dev version
            } else {
                Write-Warning "This version doesn't support update. Manual reinstall required."
                
                if (Test-NonInteractive) {
                    Write-Info "Running in non-interactive mode - proceeding with reinstall"
                } else {
                    $response = Read-Host "Proceed with manual reinstall? [Y/n]"
                    if ($response -eq 'n' -or $response -eq 'N') {
                        Write-Info "Installation cancelled"
                        exit 0
                    }
                }
            }
        }
    }
    
    # Download binary
    $tempBinary = Download-Binary $version $arch
    
    # Install binary
    $installedPath = Install-Binary $tempBinary
    
    # Update PATH
    Update-Path
    
    # Detect Claude Code
    if (Test-ClaudeCode) {
        Write-Host ""
        Write-Info "🤖 Claude Code Integration Available!" -ForegroundColor Cyan
        Write-Host "Run this command to set up the integration:"
        Write-Host ""
        Write-Host "  $CLI_NAME cc" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "This will configure cost approval hooks for AI commands."
    }
    
    Write-Host ""
    Write-Success "Installation complete! 🎉"
    Write-Host ""
    Write-Host "Get started with:"
    Write-Host "  $CLI_NAME --help" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Generate prompts from your code:"
    Write-Host "  $CLI_NAME generate src/**/*.ts" -ForegroundColor Yellow
    Write-Host ""
}

# Main entry point
if ($Uninstall) {
    Uninstall-PromptCode
}
else {
    Install-PromptCode
}