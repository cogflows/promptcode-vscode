#!/usr/bin/env bash
set -euo pipefail  # Exit on error, undefined vars, pipe failures
IFS=$'\n\t'       # Set secure Internal Field Separator

# PromptCode CLI Installer
# https://github.com/cogflows/promptcode-vscode
# 
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/cogflows/promptcode-vscode/feature/cli-integration/packages/cli/scripts/install.sh | bash
#   curl -fsSL ... | bash -s -- --uninstall

# Configuration
REPO="cogflows/promptcode-vscode"
CLI_NAME="promptcode"
INSTALL_DIR="${PROMPTCODE_INSTALL_DIR:-$HOME/.local/bin}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/promptcode"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/promptcode"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_info() {
  echo -e "${BLUE}[INFO]${NC} $1" >&2
}

print_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1" >&2
}

print_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1" >&2
}

print_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
  exit 1
}

# Check if running in interactive mode
is_interactive() {
  # Force non-interactive if NONINTERACTIVE is set
  [[ -n "${NONINTERACTIVE:-}" ]] && return 1
  
  # Force interactive if INTERACTIVE is set (with warning if no TTY)
  if [[ -n "${INTERACTIVE:-}" ]]; then
    if [[ ! -t 0 && ! -t 1 ]]; then
      print_warning "INTERACTIVE mode requested but no TTY available"
    fi
    return 0
  fi
  
  # Check if stdin and stdout are connected to a terminal
  [[ -t 0 && -t 1 ]]
}

# Safe read function that handles non-interactive environments
safe_read() {
  local prompt="$1"
  local default="${2:-}"
  
  # Check if we're in an interactive environment
  if is_interactive; then
    # Standard input is a terminal
    read -p "$prompt" -r response
  elif [[ -t 1 ]] && [[ -r /dev/tty ]] 2>/dev/null; then
    # stdout is a terminal and /dev/tty is readable (for piped scripts)
    read -p "$prompt" -r response < /dev/tty 2>/dev/null || response="$default"
  else
    # Non-interactive environment, use default
    [[ -n "$prompt" ]] && print_info "Non-interactive mode detected, using default: $default"
    response="$default"
  fi
  
  echo "$response"
}

# Safe read for single character with default
safe_read_char() {
  local prompt="$1"
  local default="${2:-}"
  
  # Check if we're in an interactive environment
  if is_interactive; then
    # Standard input is a terminal
    read -p "$prompt" -n 1 -r
    echo ""  # Add newline after single char read
  elif [[ -t 1 ]] && [[ -r /dev/tty ]] 2>/dev/null; then
    # stdout is a terminal and /dev/tty is readable (for piped scripts)
    read -p "$prompt" -n 1 -r < /dev/tty 2>/dev/null || REPLY="$default"
    [[ -n "$REPLY" ]] && echo ""  # Add newline after single char read
  else
    # Non-interactive environment, use default
    [[ -n "$prompt" ]] && print_info "Non-interactive mode detected, using default: $default"
    REPLY="$default"
  fi
}

# Detect OS and Architecture
detect_platform() {
  local os arch

  # Block Git Bash/MSYS/Cygwin on Windows
  case "$(uname -s)" in
    MINGW*|CYGWIN*|MSYS*)
      print_error "Windows shell detected. Please use PowerShell to install:\n  irm https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.ps1 | iex"
      ;;
  esac

  # Detect OS
  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    *) print_error "Unsupported operating system: $(uname -s)" ;;
  esac

  # WSL detection
  if [[ "$os" == "linux" ]] && grep -qEi "(microsoft|wsl)" /proc/version 2>/dev/null; then
    print_info "WSL detected - installing Linux binary"
  fi

  # Detect architecture
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) print_error "Unsupported architecture: $(uname -m)" ;;
  esac

  echo "${os}-${arch}"
}

# Fetch latest release version from GitHub
fetch_latest_version() {
  local url="https://api.github.com/repos/${REPO}/releases/latest"
  local version
  
  # Try GitHub API first
  version=$(curl -fsSL "$url" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/') || true
  
  # Fallback to parsing releases page if API fails (rate limit)
  if [ -z "$version" ]; then
    print_info "GitHub API unavailable, trying alternative method..."
    version=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
              "https://github.com/${REPO}/releases/latest" 2>/dev/null | \
              sed 's#.*/tag/##' || true)
  fi

  if [ -z "$version" ]; then
    print_error "Could not determine latest version. Check your internet connection."
  fi

  echo "$version"
}

# Download and verify binary
download_binary() {
  local version="$1"
  local platform="$2"
  local binary_name="${CLI_NAME}-${platform}"
  
  # Add .exe for Windows
  if [[ "$platform" == windows-* ]]; then
    binary_name="${binary_name}.exe"
  fi

  local download_url="https://github.com/${REPO}/releases/download/${version}/${binary_name}"
  local temp_file=$(mktemp)

  print_info "Downloading ${CLI_NAME} ${version} for ${platform}..."
  
  # Download with timeout and proper error handling
  if ! curl -fsSL --connect-timeout 15 --max-time 300 \
            -H "User-Agent: promptcode-installer/1.0" \
            -o "$temp_file" "$download_url"; then
    rm -f "$temp_file"
    print_error "Failed to download from: $download_url"
  fi
  
  # Verify file is binary (not HTML error page)
  if file "$temp_file" 2>/dev/null | grep -q "HTML\|ASCII text"; then
    rm -f "$temp_file"
    print_error "Downloaded file appears to be HTML/text, not a binary"
  fi
  
  # Check file size (between 10MB and 100MB)
  local file_size=$(stat -f%z "$temp_file" 2>/dev/null || stat -c%s "$temp_file" 2>/dev/null || echo 0)
  if [ "$file_size" -lt 10485760 ] || [ "$file_size" -gt 104857600 ]; then
    rm -f "$temp_file"
    print_error "Downloaded file size ($file_size bytes) outside expected range (10MB-100MB)"
  fi
  
  # Download and verify checksum (MANDATORY for security)
  local checksum_url="${download_url}.sha256"
  print_info "Verifying checksum..."
  
  if curl -fsSL --connect-timeout 10 -o "${temp_file}.sha256.orig" "$checksum_url" 2>/dev/null; then
    # Extract just the hash from the checksum file (first field)
    local expected_sum=$(awk '{print $1}' "${temp_file}.sha256.orig")
    
    # Verify checksum - try multiple commands for cross-platform compatibility
    local checksum_verified=false
    local actual_sum=""
    
    # Try sha256sum first (Linux standard)
    if command -v sha256sum >/dev/null 2>&1; then
      actual_sum=$(sha256sum "$temp_file" 2>/dev/null | awk '{print $1}')
      if [ "$expected_sum" = "$actual_sum" ]; then
        checksum_verified=true
      fi
    # Try shasum (macOS standard)
    elif command -v shasum >/dev/null 2>&1; then
      actual_sum=$(shasum -a 256 "$temp_file" 2>/dev/null | awk '{print $1}')
      if [ "$expected_sum" = "$actual_sum" ]; then
        checksum_verified=true
      fi
    # Try openssl as fallback
    elif command -v openssl >/dev/null 2>&1; then
      actual_sum=$(openssl dgst -sha256 "$temp_file" 2>/dev/null | awk '{print $NF}')
      if [ "$expected_sum" = "$actual_sum" ]; then
        checksum_verified=true
      fi
    else
      rm -f "$temp_file" "${temp_file}.sha256.orig"
      print_error "Cannot verify checksum - no SHA256 tool found (sha256sum/shasum/openssl). Installation aborted."
    fi
    
    if [ "$checksum_verified" = false ] && [ -n "$actual_sum" ]; then
      rm -f "$temp_file" "${temp_file}.sha256.orig"
      print_error "Checksum verification failed - expected: $expected_sum, got: $actual_sum"
    fi
    
    rm -f "${temp_file}.sha256.orig"
  else
    rm -f "$temp_file"
    print_error "Checksum file not available. Installation aborted for security."
  fi

  echo "$temp_file"
}

# Install the binary
install_binary() {
  local binary_path="$1"
  local target_path="${INSTALL_DIR}/${CLI_NAME}"

  # Create installation directory
  mkdir -p "$INSTALL_DIR"

  # Install with proper permissions (fallback to cp if install unavailable)
  if command -v install >/dev/null 2>&1; then
    install -m 755 "$binary_path" "$target_path"
  else
    cp "$binary_path" "$target_path"
    chmod 755 "$target_path"
  fi
  rm -f "$binary_path"

  print_success "${CLI_NAME} installed to ${target_path}"
}

# Check and update PATH
check_path() {
  if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
    print_warning "${INSTALL_DIR} is not in your PATH"
    echo ""
    
    # Detect shell config file
    local shell_config=""
    case "$SHELL" in
      */bash) 
        if [[ -f "$HOME/.bash_profile" ]]; then
          shell_config="$HOME/.bash_profile"
        else
          shell_config="$HOME/.bashrc"
        fi
        ;;
      */zsh) shell_config="$HOME/.zshrc" ;;
      */fish) shell_config="$HOME/.config/fish/config.fish" ;;
      *) shell_config="" ;;
    esac
    
    if [[ -n "$shell_config" ]]; then
      # Check if PATH export already exists (idempotent)
      if ! grep -q "# PromptCode CLI PATH" "$shell_config" 2>/dev/null; then
        echo "Would you like to add ${INSTALL_DIR} to your PATH automatically? [Y/n]" >&2
        response=$(safe_read "" "Y")
        if [[ ! "$response" =~ ^[Nn]$ ]]; then
          if [[ "$SHELL" == */fish ]]; then
            echo "# PromptCode CLI PATH" >> "$shell_config"
            echo "set -gx PATH \$PATH ${INSTALL_DIR}" >> "$shell_config"
          else
            echo "" >> "$shell_config"
            echo "# PromptCode CLI PATH" >> "$shell_config"
            echo "export PATH=\"\$PATH:${INSTALL_DIR}\"" >> "$shell_config"
          fi
          print_success "PATH updated in $shell_config"
          echo "Please restart your shell or run: source $shell_config" >&2
        else
          echo "Add this to your shell configuration file ($shell_config):" >&2
          echo "  export PATH=\"\$PATH:${INSTALL_DIR}\"" >&2
        fi
      else
        print_info "PATH entry already exists in $shell_config"
      fi
    else
      echo "Add this to your shell configuration file:" >&2
      echo "  export PATH=\"\$PATH:${INSTALL_DIR}\"" >&2
    fi
  fi
}

# Detect Claude Code environment
detect_claude_code() {
  local current_dir="$PWD"
  local claude_found=false

  # Check environment variable first
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    claude_found=true
    print_info "Claude Code environment detected (via CLAUDE_PROJECT_DIR)"
  else
    # Search for .claude folder up to 5 levels
    local check_dir="$current_dir"
    local levels=0
    while [ "$check_dir" != "/" ] && [ $levels -lt 5 ]; do
      if [ -d "$check_dir/.claude" ]; then
        claude_found=true
        print_info "Claude Code project detected at: $check_dir"
        break
      fi
      check_dir=$(dirname "$check_dir")
      ((levels++))
    done
  fi

  if [ "$claude_found" = true ]; then
    echo "" >&2
    print_info "🤖 Claude Code Integration Available!"
    echo "Run this command to set up the integration:" >&2
    echo "" >&2
    echo "  ${CLI_NAME} cc" >&2
    echo "" >&2
    echo "This will configure cost approval hooks for AI commands." >&2
  fi
}

# Uninstall function
uninstall() {
  print_info "Uninstalling ${CLI_NAME}..."

  # Remove binary
  local binary_path="${INSTALL_DIR}/${CLI_NAME}"
  if [ -f "$binary_path" ]; then
    rm -f "$binary_path"
    print_success "Removed binary: $binary_path"
  else
    print_warning "Binary not found at $binary_path"
  fi

  # Ask about cache and config
  echo ""
  safe_read_char "Remove configuration and cache files? [y/N] " "N"
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [ -d "$CONFIG_DIR" ]; then
      rm -rf "$CONFIG_DIR"
      print_success "Removed config: $CONFIG_DIR"
    fi
    if [ -d "$CACHE_DIR" ]; then
      rm -rf "$CACHE_DIR"
      print_success "Removed cache: $CACHE_DIR"
    fi
  fi

  print_success "Uninstall complete"
  echo "" >&2
  echo "Don't forget to remove ${INSTALL_DIR} from your PATH if you added it." >&2
}

# Main installation flow
main() {
  # Simple, compact banner that works in narrow terminals (35 chars wide)
  echo "" >&2
  echo "  ╭───────────────────────────────╮" >&2
  echo "  │   PromptCode CLI Installer   │" >&2  
  echo "  ╰───────────────────────────────╯" >&2
  echo "" >&2

  # Handle uninstall
  if [ "${1:-}" = "--uninstall" ]; then
    uninstall
    exit 0
  fi

  # Detect platform
  local platform=$(detect_platform)
  print_info "Detected platform: $platform"

  # Get latest version
  print_info "Fetching latest version..."
  local version=$(fetch_latest_version)

  # Check if already installed
  if command -v "$CLI_NAME" >/dev/null 2>&1; then
    local current_version=$("$CLI_NAME" --version 2>/dev/null || echo "unknown")
    print_info "${CLI_NAME} is already installed (version: $current_version)"
    print_info "Latest version available: $version"
    
    # Check if it's a development version or if update is available
    if [[ "$current_version" == *"-dev."* ]]; then
      print_warning "You're running a development version"
    fi
    
    # Check if update command exists (newer versions have it)
    if "$CLI_NAME" update --help >/dev/null 2>&1; then
      # For dev versions, inform about --force option
      if [[ "$current_version" == *"-dev."* ]]; then
        print_info "Development version detected. To force update to $version:"
        echo "" >&2
        echo "  ${CLI_NAME} update --force" >&2
        echo "" >&2
        safe_read_char "Run this command now? [Y/n] " "Y"
        if [[ $REPLY =~ ^[Yy]$ ]] || [ -z "$REPLY" ]; then
          # Try to run update --force, but if it fails (old version), continue with direct install
          if ! "$CLI_NAME" update --force 2>&1; then
            print_warning "Current version doesn't support --force flag"
            print_info "Proceeding with direct installation of $version"
            # Continue with the installation (don't exit)
          else
            exit 0  # Successful update
          fi
        else
          print_info "You can run the command manually later"
          exit 0
        fi
      else
        print_info "Using built-in update to upgrade..."
        echo "" >&2
        "$CLI_NAME" update 2>&1
        exit 0  # Successful update
      fi
    else
      # Older version without update
      if [[ "$current_version" == *"-dev."* ]]; then
        print_warning "This development version doesn't support update."
        print_info "Will force reinstall with latest release version ($version)"
        safe_read_char "Proceed with force reinstall? [Y/n] " "Y"
        if [[ ! $REPLY =~ ^[Yy]$ ]] && [ -n "$REPLY" ]; then
          print_info "Installation cancelled"
          exit 0
        fi
        # Continue with installation - will overwrite the dev version
      else
        print_warning "This version doesn't support update. Manual reinstall required."
        safe_read_char "Proceed with manual reinstall? [Y/n] " "Y"
        if [[ ! $REPLY =~ ^[Yy]$ ]] && [ -n "$REPLY" ]; then
          print_info "Installation cancelled"
          exit 0
        fi
      fi
    fi
  fi

  # Download binary
  local temp_binary=$(download_binary "$version" "$platform")

  # Install binary
  install_binary "$temp_binary"

  # Check PATH
  check_path

  # Detect Claude Code
  detect_claude_code

  echo "" >&2
  print_success "Installation complete! 🎉"
  echo "" >&2
  echo "Get started with:" >&2
  echo "  ${CLI_NAME} --help" >&2
  echo "" >&2
  echo "Generate prompts from your code:" >&2
  echo "  ${CLI_NAME} generate src/**/*.ts" >&2
  echo "" >&2
}

# Handle errors
trap 'print_error "Installation failed on line $LINENO"' ERR

# Run main function
main "$@"