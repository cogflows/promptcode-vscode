#!/usr/bin/env bash
set -euo pipefail  # Exit on error, undefined vars, pipe failures
IFS=$'\n\t'       # Set secure Internal Field Separator

# PromptCode CLI Installer
# https://github.com/cogflows/promptcode-vscode
# 
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.sh | bash
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

# TTY file descriptor for consistent terminal I/O
TTY_FD=-1

# Open a terminal FD if available (call this once at script start)
open_tty() {
  if [[ -t 0 ]]; then 
    TTY_FD=0
    return 0
  fi
  # Try to open /dev/tty if it exists (handle failure gracefully)
  # Use || true to prevent set -e from exiting
  if { exec 3<>/dev/tty; } 2>/dev/null; then
    TTY_FD=3
    return 0
  fi
  TTY_FD=-1
  return 1
}

# Check if running in interactive mode
is_interactive() {
  # Force non-interactive if NONINTERACTIVE is set
  [[ -n "${NONINTERACTIVE:-}" ]] && return 1
  
  # Force interactive if INTERACTIVE is set and we have a TTY
  if [[ -n "${INTERACTIVE:-}" ]]; then
    if (( TTY_FD >= 0 )); then
      return 0
    else
      print_warning "INTERACTIVE mode requested but no TTY available"
      return 1
    fi
  fi
  
  # Check if CI environment (treat as non-interactive unless INTERACTIVE is set)
  if [[ "${CI:-}" == "true" || -n "${GITHUB_ACTIONS:-}" || -n "${GITLAB_CI:-}" ]]; then
    return 1
  fi
  
  # Interactive if we have a TTY
  (( TTY_FD >= 0 ))
}

# Safe read function that handles non-interactive environments
safe_read() {
  local prompt="$1"
  local default="${2:-}"
  local line
  
  if (( TTY_FD >= 0 )); then
    # Write prompt to terminal and read response
    printf "%s" "$prompt" >&$TTY_FD
    if IFS= read -r -u $TTY_FD line; then
      echo "$line"
    else
      echo "$default"
    fi
  else
    # Non-interactive environment, use default
    [[ -n "$prompt" ]] && print_info "Non-interactive mode detected, using default: $default"
    echo "$default"
  fi
}

# Safe read for single character with default
safe_read_char() {
  local prompt="$1"
  local default="${2:-}"
  
  if (( TTY_FD >= 0 )); then
    # Write prompt to terminal and read single char
    printf "%s" "$prompt" >&$TTY_FD
    if IFS= read -r -n 1 -u $TTY_FD REPLY; then
      printf "\n" >&$TTY_FD  # Add newline after single char read
    else
      REPLY="$default"
    fi
  else
    # Non-interactive environment, use default
    [[ -n "$prompt" ]] && print_info "Non-interactive mode detected, using default: $default"
    REPLY="$default"
  fi
}

# Ask yes/no question with default
ask_yes_no() {
  local prompt="$1"
  local default="${2:-Y}"
  safe_read_char "$prompt" ""
  local ans="${REPLY:-$default}"
  [[ -z "$ans" ]] && ans="$default"
  [[ "$ans" =~ ^[Yy]$ ]]
}

# Normalize version string (remove v prefix and suffixes)
normalize_version() {
  printf "%s" "$1" | sed -E 's/^v//; s/[^0-9.].*$//'
}

# Detect OS and Architecture
detect_platform() {
  local os arch

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
  # Allow override via environment variable for testing
  if [ -n "${PROMPTCODE_TEST_VERSION:-}" ]; then
    local v="$PROMPTCODE_TEST_VERSION"
    [[ "$v" != v* ]] && v="v$v"
    echo "$v"
    return
  fi
  
  local url="https://api.github.com/repos/${REPO}/releases/latest"
  local version
  
  # Try GitHub API first (with timeout to prevent hanging in CI)
  version=$(curl -fsSL --connect-timeout 5 --max-time 10 "$url" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/') || true
  
  # Fallback to parsing releases page if API fails (rate limit)
  if [ -z "$version" ]; then
    print_info "GitHub API unavailable, trying alternative method..."
    version=$(curl -fsSLI --connect-timeout 5 --max-time 10 -o /dev/null -w '%{url_effective}' \
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
  # Portable mktemp - try GNU style first, then BSD style
  local temp_file=$(mktemp 2>/dev/null || mktemp -t promptcode)

  print_info "Downloading ${CLI_NAME} ${version} for ${platform}..."
  
  # Download with timeout and proper error handling
  if ! curl -fsSL --connect-timeout 15 --max-time 300 \
            -H "User-Agent: promptcode-installer/1.0" \
            -o "$temp_file" "$download_url"; then
    rm -f "$temp_file"
    print_error "Failed to download from: $download_url"
  fi
  
  # Verify file is binary (not HTML error page) - only if 'file' command exists
  if command -v file >/dev/null 2>&1; then
    if file "$temp_file" 2>/dev/null | grep -q "HTML\|ASCII text"; then
      rm -f "$temp_file"
      print_error "Downloaded file appears to be HTML/text, not a binary"
    fi
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
  local temp_target="${target_path}.tmp.$$"

  # Create installation directory
  mkdir -p "$INSTALL_DIR"

  # Install atomically: copy to temp file, set permissions, then move
  # This prevents partial writes if process is interrupted
  if command -v install >/dev/null 2>&1; then
    # install command can atomically set permissions
    install -m 755 "$binary_path" "$temp_target"
  else
    # Manual atomic install
    cp "$binary_path" "$temp_target"
    chmod 755 "$temp_target"
  fi
  
  # Atomic rename (on same filesystem, this is atomic)
  mv -f "$temp_target" "$target_path"
  
  # Clean up source
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
        # Default to "N" in non-interactive mode for security
        if is_interactive; then
          if ask_yes_no "Would you like to add ${INSTALL_DIR} to your PATH automatically? [Y/n] " "Y"; then
            if [[ "$SHELL" == */fish ]]; then
              # Ensure fish config directory exists
              mkdir -p "$HOME/.config/fish"
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
          print_info "Non-interactive mode: skipping PATH modification for security."
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
  if ask_yes_no "Remove configuration and cache files? [y/N] " "N"; then
    if [ -d "$CONFIG_DIR" ]; then
      rm -rf "$CONFIG_DIR"
      print_success "Removed config: $CONFIG_DIR"
    fi
    if [ -d "$CACHE_DIR" ]; then
      rm -rf "$CACHE_DIR"
      print_success "Removed cache: $CACHE_DIR"
    fi
  fi

  # Remove PATH entries from shell configs
  echo ""
  if ask_yes_no "Remove PATH entries from shell configurations? [Y/n] " "Y"; then
    local configs=()
    [ -f "$HOME/.bashrc" ] && configs+=("$HOME/.bashrc")
    [ -f "$HOME/.bash_profile" ] && configs+=("$HOME/.bash_profile")
    [ -f "$HOME/.zshrc" ] && configs+=("$HOME/.zshrc")
    [ -f "$HOME/.config/fish/config.fish" ] && configs+=("$HOME/.config/fish/config.fish")
    [ -f "$HOME/.profile" ] && configs+=("$HOME/.profile")
    
    for config in "${configs[@]}"; do
      if grep -q "${INSTALL_DIR}" "$config" 2>/dev/null; then
        # Create backup
        cp "$config" "${config}.promptcode-backup"
        
        # Escape all regex metacharacters in INSTALL_DIR for safe sed usage
        local escaped_dir=$(printf '%s' "$INSTALL_DIR" | sed -e 's/[\\.*+?{}()\[\]|^$]/\\\\&/g' -e 's/\//\\\//g')
        
        # Remove PATH entries containing INSTALL_DIR (handle various formats)
        if [[ "$config" == *"config.fish" ]]; then
          # Fish shell uses different syntax - remove both fish_add_path and set -gx PATH lines
          awk -v dir="${INSTALL_DIR}" '
            !(/fish_add_path/ && index($0, dir)) && 
            !((/^[[:space:]]*set[[:space:]]+-gx[[:space:]]+PATH/ || /^set[[:space:]]+-gx[[:space:]]+PATH/) && index($0, dir))
          ' "$config" > "${config}.tmp" && mv "${config}.tmp" "$config"
        else
          # Bash/Zsh use export PATH - handle multiple formats
          # This handles: export PATH="...", export PATH='...', PATH="...", PATH='...', export PATH=$PATH:...
          # Also remove the "# PromptCode CLI PATH" comment if it exists
          sed -E "/# PromptCode CLI PATH/d; /export[[:space:]]+PATH.*${escaped_dir}/d; /^[[:space:]]*PATH.*${escaped_dir}/d" "$config" > "${config}.tmp" && mv "${config}.tmp" "$config"
        fi
        print_success "Removed PATH entry from: $config (backup: ${config}.promptcode-backup)"
      fi
    done
  else
    echo "To remove PATH entries manually, edit your shell config and remove lines containing: ${INSTALL_DIR}" >&2
  fi
  
  print_success "Uninstall complete"
}

# Main installation flow
main() {
  # Open TTY file descriptor for interactive I/O (ignore failure)
  open_tty || true
  
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

  # Block Git Bash/MSYS/Cygwin on Windows early
  case "$(uname -s)" in
    MINGW*|CYGWIN*|MSYS*)
      print_error "Windows shell detected. Please use PowerShell to install:\n  irm https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.ps1 | iex"
      exit 1
      ;;
  esac

  # Detect platform
  local platform=$(detect_platform)
  print_info "Detected platform: $platform"

  # Get latest version
  print_info "Fetching latest version..."
  local version=$(fetch_latest_version)

  # Check if already installed
  if command -v "$CLI_NAME" >/dev/null 2>&1; then
    local current_version_raw=$("$CLI_NAME" --version 2>/dev/null || echo "unknown")
    local current_version=$(normalize_version "$current_version_raw")
    print_info "${CLI_NAME} is already installed (version: $current_version_raw)"
    print_info "Latest version available: $version"
    
    # Check if it's a development version or if update is available
    if [[ "$current_version_raw" == *"-dev."* ]]; then
      print_warning "You're running a development version"
    fi
    
    # Check if update command exists AND version is 0.6.9 or newer
    # (older versions have broken update that doesn't finalize properly)
    local version_ok_for_update=false
    if [[ "$current_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
      local major="${BASH_REMATCH[1]}"
      local minor="${BASH_REMATCH[2]}"
      local patch="${BASH_REMATCH[3]}"
      # Version must be >= 0.6.9 for working update command
      if (( major > 0 )) || (( major == 0 && minor > 6 )) || (( major == 0 && minor == 6 && patch >= 9 )); then
        version_ok_for_update=true
      fi
    fi
    
    # Check if update command exists (newer versions have it) AND version supports it properly
    if "$CLI_NAME" update --help >/dev/null 2>&1 && [[ "$version_ok_for_update" == "true" ]]; then
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
      # Older version without update or version with broken update command
      if [[ "$version_ok_for_update" == "false" ]] && [[ "$current_version" =~ ^0\.6\.[0-8]$ ]]; then
        print_warning "Version $current_version has a known update issue. Direct reinstall required."
        print_info "Will perform clean installation of version $version"
        safe_read_char "Proceed with direct reinstall? [Y/n] " "Y"
        if [[ ! $REPLY =~ ^[Yy]$ ]] && [ -n "$REPLY" ]; then
          print_info "Installation cancelled"
          exit 0
        fi
        # Continue with installation - will overwrite the broken version
      elif [[ "$current_version" == *"-dev."* ]]; then
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
  
  # Check if download was successful
  if [ -z "$temp_binary" ] || [ ! -f "$temp_binary" ]; then
    print_error "Failed to download binary"
    exit 1
  fi

  # Install binary
  install_binary "$temp_binary"

  # Check PATH
  check_path

  echo "" >&2
  print_success "Installation complete! 🎉"
  
  # Automatically check for integrations
  echo "" >&2
  print_info "Checking for AI environment integrations..."
  # Run integration check with proper TTY handling using our FD
  if (( TTY_FD >= 0 )); then
    # Ensure integrate both reads from and writes to the terminal
    if (( TTY_FD == 0 )); then
      # stdin is already TTY, run normally
      "${CLI_NAME}" integrate --auto-detect || true
    else
      # Redirect stdin/stdout/stderr to TTY for full interaction
      "${CLI_NAME}" integrate --auto-detect <&$TTY_FD >&$TTY_FD 2>&$TTY_FD || true
    fi
  else
    # Non-interactive, just do silent check
    "${CLI_NAME}" integrate --auto-detect 2>/dev/null || true
  fi
  
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