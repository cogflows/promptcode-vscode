# PromptCode CLI Installer for Windows
# https://github.com/cogflows/promptcode-vscode
#
# Usage:
#   irm https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.ps1 | iex
#   or
#   Invoke-WebRequest ... | Invoke-Expression

param(
    [switch]$Uninstall
)

# Configuration
$REPO = "cogflows/promptcode-vscode"
$CLI_NAME = "promptcode"
$DEFAULT_INSTALL_DIR = "$env:LOCALAPPDATA\PromptCode\bin"
$INSTALL_DIR = if ($env:PROMPTCODE_INSTALL_DIR) { $env:PROMPTCODE_INSTALL_DIR } else { $DEFAULT_INSTALL_DIR }

# Helper functions
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
    $arch = [System.Environment]::Is64BitOperatingSystem
    if ($arch) {
        return "x64"
    } else {
        Write-Error "32-bit Windows is not supported"
    }
}

# Fetch latest version from GitHub
function Get-LatestVersion {
    Write-Info "Fetching latest version..."
    
    try {
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest"
        $version = $releases.tag_name
        Write-Info "Latest version: $version"
        return $version
    }
    catch {
        Write-Error "Could not fetch latest version. Check your internet connection."
    }
}

# Download binary
function Download-Binary($version, $arch) {
    $binaryName = "${CLI_NAME}-windows-${arch}.exe"
    $downloadUrl = "https://github.com/$REPO/releases/download/$version/$binaryName"
    $tempFile = [System.IO.Path]::GetTempFileName() + ".exe"
    
    Write-Info "Downloading $CLI_NAME $version for Windows $arch..."
    
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing
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
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    
    if ($currentPath -notlike "*$INSTALL_DIR*") {
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
    
    # Ask about cache and config
    $response = Read-Host "Remove configuration and cache files? [y/N]"
    if ($response -eq 'y' -or $response -eq 'Y') {
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
    
    # Remove from PATH
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -like "*$INSTALL_DIR*") {
        $newPath = ($currentPath -split ';' | Where-Object { $_ -ne $INSTALL_DIR }) -join ';'
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
        
        # Check if self-update command exists
        try {
            & $CLI_NAME self-update --help 2>$null | Out-Null
            
            # For dev versions, inform about --force option
            if ($currentVersion -like "*-dev.*") {
                Write-Info "Development version detected. To force update to $version:"
                Write-Host ""
                Write-Host "  $CLI_NAME self-update --force" -ForegroundColor Cyan
                Write-Host ""
                $response = Read-Host "Run this command now? [Y/n]"
                if ($response -ne 'n' -and $response -ne 'N') {
                    & $CLI_NAME self-update --force
                    exit $LASTEXITCODE
                } else {
                    Write-Info "You can run the command manually later"
                    exit 0
                }
            } else {
                Write-Info "Using built-in self-update to upgrade..."
                Write-Host ""
                & $CLI_NAME self-update
                exit $LASTEXITCODE
            }
        } catch {
            # Older version without self-update
            Write-Warning "This version doesn't support self-update. Manual reinstall required."
            $response = Read-Host "Proceed with manual reinstall? [Y/n]"
            if ($response -eq 'n' -or $response -eq 'N') {
                Write-Info "Installation cancelled"
                Write-Info "To update manually later, run: promptcode self-update"
                exit 0
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