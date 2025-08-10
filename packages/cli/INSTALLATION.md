# PromptCode CLI Installation Guide

## Quick Install (Recommended)

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.sh | bash
```

### Windows

Open PowerShell as Administrator and run:

```powershell
irm https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.ps1 | iex
```

## What Gets Installed

The installer will:
1. Download the latest PromptCode CLI binary for your platform
2. Install it to `~/.local/bin/promptcode` (Unix) or `%LOCALAPPDATA%\PromptCode\bin` (Windows)
3. Add the installation directory to your PATH if needed
4. Detect Claude Code projects and suggest integration setup

## Verify Installation

```bash
promptcode --version
promptcode --help
```

## Updating

PromptCode CLI includes automatic update checking and update capabilities:

```bash
# Manually update to the latest version
promptcode update

# Force update even if on latest version
promptcode update --force
```

The CLI automatically checks for updates in the background once per day when you run any command. If a new version is available, you'll see a notification at the end of your command execution. This check runs asynchronously and won't slow down your workflow.

## Uninstalling

### Method 1: Built-in Uninstaller

```bash
promptcode uninstall
```

This will:
- Remove the binary
- Optionally remove configuration and cache files
- Provide instructions for PATH cleanup

### Method 2: Using the Installer Script

```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.sh | bash -s -- --uninstall

# Windows
irm https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.ps1 | iex -ArgumentList @('-Uninstall')
```

## Manual Installation

If you prefer to install manually:

1. Download the appropriate binary from [GitHub Releases](https://github.com/cogflows/promptcode-vscode/releases)
2. Make it executable (Unix only): `chmod +x promptcode-*`
3. Move to a directory in your PATH: `mv promptcode-* /usr/local/bin/promptcode`

## Platform-Specific Notes

### macOS
- Requires macOS 13.0 or later
- First run may trigger Gatekeeper warning - allow in System Preferences
- For Apple Silicon Macs, we provide native arm64 binaries

### Linux
- Binaries are statically linked and should work on most distributions
- Requires glibc 2.31+ (Ubuntu 20.04+, Debian 11+, RHEL 8+)

### Windows
- Requires Windows 10 or later
- May need to adjust PowerShell execution policy
- Windows Defender may scan the binary on first run

## Environment Variables

- `PROMPTCODE_INSTALL_DIR`: Override default installation directory
- `PROMPTCODE_NO_UPDATE_CHECK=1`: Disable automatic update checks
- `CLAUDE_PROJECT_DIR`: Automatically detected for Claude Code integration

## Troubleshooting

### "Command not found" after installation
The installation directory needs to be in your PATH. The installer provides instructions for your specific shell.

### Permission denied
- **Unix**: Use `sudo` if installing to system directories
- **Windows**: Run PowerShell as Administrator

### Corporate proxy/firewall
Set proxy environment variables before running the installer:
```bash
export https_proxy=http://proxy.company.com:8080
export HTTPS_PROXY=$https_proxy
```

### Slow download
The installer downloads from GitHub releases. If slow, you can manually download from the [releases page](https://github.com/cogflows/promptcode-vscode/releases).

## Building from Source

If you want to build from source instead:

```bash
# Clone the repository
git clone https://github.com/cogflows/promptcode-vscode.git
cd promptcode-vscode/packages/cli

# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies and build
bun install
bun run build:prod

# Binary will be at dist/promptcode
./dist/promptcode --version
```

## Security

- All binaries are built via GitHub Actions from public source code
- SHA256 checksums are provided for verification (coming soon)
- The installer uses HTTPS for all downloads
- Consider reviewing the installer script before running

## Support

- **Issues**: [GitHub Issues](https://github.com/cogflows/promptcode-vscode/issues)
- **Documentation**: [README](https://github.com/cogflows/promptcode-vscode/blob/main/packages/cli/README.md)
- **Claude Code Integration**: Run `promptcode cc` after installation