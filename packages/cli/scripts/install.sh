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
  local ch=""

  if (( TTY_FD >= 0 )); then
    # Write prompt to terminal and read single char
    printf "%s" "$prompt" >&$TTY_FD
    if IFS= read -r -n 1 -u $TTY_FD ch; then
      printf "\n" >&$TTY_FD  # Add newline after single char read
    else
      ch="$default"
    fi
  else
    # Non-interactive environment, use default
    [[ -n "$prompt" ]] && print_info "Non-interactive mode detected, using default: $default"
    ch="$default"
  fi
  printf "%s" "$ch"
}

# Ask yes/no question with default
ask_yes_no() {
  local prompt="$1"
  local default="${2:-Y}"
  local ans
  ans="$(safe_read_char "$prompt" "")"
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

# Detect user's actual shell(s) - more robust than just $SHELL
detect_user_shells() {
  local shells=()
  
  # 1. Check the actual parent process (most accurate for current session)
  if command -v ps >/dev/null 2>&1; then
    local parent_pid="${PPID:-$$}"
    local parent_cmd=$(ps -p "$parent_pid" -o comm= 2>/dev/null | sed 's/^-//')
    case "$parent_cmd" in
      bash|zsh|fish|sh|dash|ksh) shells+=("$parent_cmd") ;;
    esac
  fi
  
  # 2. Check $SHELL environment variable (user's default shell)
  if [[ -n "$SHELL" ]]; then
    local shell_name=$(basename "$SHELL")
    # Add if not already in array (handle empty array case)
    if [[ ${#shells[@]} -eq 0 ]] || [[ ! " ${shells[@]} " =~ " ${shell_name} " ]]; then
      shells+=("$shell_name")
    fi
  fi
  
  # 3. Check /etc/passwd for user's login shell
  if command -v getent >/dev/null 2>&1; then
    local login_shell=$(getent passwd "$USER" 2>/dev/null | cut -d: -f7)
    if [[ -n "$login_shell" ]]; then
      local shell_name=$(basename "$login_shell")
      # Add if not already in array (handle empty array case)
      if [[ ${#shells[@]} -eq 0 ]] || [[ ! " ${shells[@]} " =~ " ${shell_name} " ]]; then
        shells+=("$shell_name")
      fi
    fi
  fi
  
  # Return unique shells found (handle empty array)
  if [[ ${#shells[@]} -gt 0 ]]; then
    printf '%s\n' "${shells[@]}" | sort -u
  fi
}

# Get shell config file(s) to update
get_shell_configs() {
  local configs=()
  
  # Get all detected shells
  local detected_shells=($(detect_user_shells))
  
  # If no shells detected, fall back to common ones based on what configs exist
  if [[ ${#detected_shells[@]} -eq 0 ]]; then
    # Check for common shell configs that exist
    [[ -f "$HOME/.zshrc" || -f "$HOME/.zprofile" ]] && detected_shells+=("zsh")
    [[ -f "$HOME/.bashrc" || -f "$HOME/.bash_profile" ]] && detected_shells+=("bash") 
    [[ -f "$HOME/.config/fish/config.fish" ]] && detected_shells+=("fish")
  fi
  
  # Map each shell to its config file(s)
  for shell in "${detected_shells[@]}"; do
    case "$shell" in
      bash)
        # On macOS, .bash_profile is preferred for login shells
        # On Linux, .bashrc is more common
        if [[ "$(uname)" == "Darwin" ]]; then
          [[ -f "$HOME/.bash_profile" ]] && configs+=("$HOME/.bash_profile")
          [[ -f "$HOME/.bashrc" ]] && configs+=("$HOME/.bashrc")
        else
          [[ -f "$HOME/.bashrc" ]] && configs+=("$HOME/.bashrc")
          [[ -f "$HOME/.bash_profile" ]] && configs+=("$HOME/.bash_profile")
        fi
        # Always check .profile as fallback
        [[ -f "$HOME/.profile" ]] && configs+=("$HOME/.profile")
        ;;
      zsh)
        # For zsh, .zshrc is preferred (runs for all shells)
        # .zprofile only runs for login shells
        [[ -f "$HOME/.zshrc" ]] && configs+=("$HOME/.zshrc")
        [[ -f "$HOME/.zprofile" ]] && configs+=("$HOME/.zprofile")
        # Create .zshrc if it doesn't exist (zsh is default on modern macOS)
        if [[ ! -f "$HOME/.zshrc" && ! -f "$HOME/.zprofile" ]]; then
          configs+=("$HOME/.zshrc")
        fi
        ;;
      fish)
        configs+=("$HOME/.config/fish/config.fish")
        ;;
    esac
  done
  
  # Also add configs for other shells if they exist and have reasonable size
  # This ensures we update PATH for all shells a user might use
  if [[ ! " ${detected_shells[@]} " =~ " bash " ]]; then
    if [[ -f "$HOME/.bashrc" && $(stat -f%z "$HOME/.bashrc" 2>/dev/null || stat -c%s "$HOME/.bashrc" 2>/dev/null || echo 0) -gt 0 ]] || \
       [[ -f "$HOME/.bash_profile" && $(stat -f%z "$HOME/.bash_profile" 2>/dev/null || stat -c%s "$HOME/.bash_profile" 2>/dev/null || echo 0) -gt 0 ]]; then
      [[ "$(uname)" == "Darwin" ]] && [[ -f "$HOME/.bash_profile" ]] && configs+=("$HOME/.bash_profile")
      [[ -f "$HOME/.bashrc" ]] && configs+=("$HOME/.bashrc")
    fi
  fi
  
  if [[ ! " ${detected_shells[@]} " =~ " zsh " ]]; then
    if [[ -f "$HOME/.zshrc" && $(stat -f%z "$HOME/.zshrc" 2>/dev/null || stat -c%s "$HOME/.zshrc" 2>/dev/null || echo 0) -gt 0 ]] || \
       [[ -f "$HOME/.zprofile" && $(stat -f%z "$HOME/.zprofile" 2>/dev/null || stat -c%s "$HOME/.zprofile" 2>/dev/null || echo 0) -gt 0 ]]; then
      [[ -f "$HOME/.zshrc" ]] && configs+=("$HOME/.zshrc")
      [[ -f "$HOME/.zprofile" ]] && configs+=("$HOME/.zprofile")
    fi
  fi
  
  # Remove duplicates and return
  printf '%s\n' "${configs[@]}" | sort -u
}

# Check and update PATH
check_path() {
  if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
    print_warning "${INSTALL_DIR} is not in your PATH"
    echo ""
    
    # Get all shell configs to potentially update
    local shell_configs=($(get_shell_configs))
    
    if [[ ${#shell_configs[@]} -gt 0 ]]; then
      print_info "Detected shell configuration file(s):"
      for config in "${shell_configs[@]}"; do
        echo "  - $config" >&2
      done
      echo ""
      
      # Track which configs need updating
      local configs_to_update=()
      for config in "${shell_configs[@]}"; do
        if ! grep -q "# PromptCode CLI PATH" "$config" 2>/dev/null; then
          configs_to_update+=("$config")
        fi
      done
      
      if [[ ${#configs_to_update[@]} -gt 0 ]]; then
        # Default to "N" in non-interactive mode for security
        if is_interactive; then
          if ask_yes_no "Would you like to add ${INSTALL_DIR} to your PATH in these files? [Y/n] " "Y"; then
            for config in "${configs_to_update[@]}"; do
              # Create parent directory if needed
              local config_dir=$(dirname "$config")
              [[ ! -d "$config_dir" ]] && mkdir -p "$config_dir"
              
              # Add PATH based on shell type
              if [[ "$config" == *"fish/config.fish" ]]; then
                echo "# PromptCode CLI PATH" >> "$config"
                echo "fish_add_path -g ${INSTALL_DIR}" >> "$config"
              else
                # Bash/Zsh use same syntax
                echo "" >> "$config"
                echo "# PromptCode CLI PATH" >> "$config"
                echo "export PATH=\"\$PATH:${INSTALL_DIR}\"" >> "$config"
              fi
              print_success "PATH updated in $config"
            done
            echo ""
            echo "Please restart your shell or run one of:" >&2
            for config in "${configs_to_update[@]}"; do
              echo "  source $config" >&2
            done
          else
            echo "Add this to your shell configuration file(s):" >&2
            echo "  export PATH=\"\$PATH:${INSTALL_DIR}\"" >&2
            echo "" >&2
            echo "For fish shell, use:" >&2
            echo "  set -gx PATH \$PATH ${INSTALL_DIR}" >&2
          fi
        else
          print_info "Non-interactive mode: skipping PATH modification for security."
          echo "Add this to your shell configuration file(s):" >&2
          for config in "${configs_to_update[@]}"; do
            echo "  $config" >&2
          done
          echo "" >&2
          echo "Use this command:" >&2
          echo "  export PATH=\"\$PATH:${INSTALL_DIR}\"" >&2
          echo "" >&2
          echo "For fish shell, use:" >&2
          echo "  set -gx PATH \$PATH ${INSTALL_DIR}" >&2
        fi
      else
        print_info "PATH entry already exists in all detected shell configs"
      fi
    else
      # No shell configs detected, provide generic instructions
      echo "Could not detect shell configuration files." >&2
      echo "" >&2
      echo "Add this to your shell configuration file:" >&2
      echo "  export PATH=\"\$PATH:${INSTALL_DIR}\"" >&2
      echo "" >&2
      echo "Common configuration files:" >&2
      echo "  - Bash: ~/.bashrc or ~/.bash_profile" >&2
      echo "  - Zsh: ~/.zshrc or ~/.zprofile" >&2
      echo "  - Fish: ~/.config/fish/config.fish" >&2
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
    # Use the same detection logic as installation
    local all_configs=()
    
    # Get detected shell configs
    local detected_configs=($(get_shell_configs))
    for config in "${detected_configs[@]}"; do
      [[ -f "$config" ]] && all_configs+=("$config")
    done
    
    # Also check for any other configs that might have been modified
    local other_configs=(
      "$HOME/.bashrc"
      "$HOME/.bash_profile"
      "$HOME/.zshrc"
      "$HOME/.zprofile"
      "$HOME/.config/fish/config.fish"
      "$HOME/.profile"
    )
    
    for config in "${other_configs[@]}"; do
      if [[ -f "$config" ]] && [[ ! " ${all_configs[@]} " =~ " ${config} " ]]; then
        # Check if this config has our PATH entry
        if grep -q "# PromptCode CLI PATH\|${INSTALL_DIR}" "$config" 2>/dev/null; then
          all_configs+=("$config")
        fi
      fi
    done
    
    # Remove duplicates
    local configs=($(printf '%s\n' "${all_configs[@]}" | sort -u))
    
    if [[ ${#configs[@]} -gt 0 ]]; then
      print_info "Found PromptCode PATH entries in:"
      for config in "${configs[@]}"; do
        echo "  - $config" >&2
      done
      echo ""
    fi
    
    for config in "${configs[@]}"; do
      if grep -q "${INSTALL_DIR}" "$config" 2>/dev/null; then
        # Create backup
        cp "$config" "${config}.promptcode-backup"
        
        # Escape all regex metacharacters in INSTALL_DIR for safe sed usage
        local escaped_dir=$(printf '%s' "$INSTALL_DIR" | sed -e 's/[\\.*+?{}()\[\]|^$]/\\\\&/g' -e 's/\//\\\//g')
        
        # Remove PATH entries containing INSTALL_DIR (handle various formats)
        if [[ "$config" == *"config.fish" ]]; then
          # Fish shell uses fish_add_path - remove both old and new formats
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
  # Parse flags
  local DRY_RUN=false
  local NO_PATH=false
  local HELP=false
  local LOCAL_BINARY=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      --no-path)
        NO_PATH=true
        shift
        ;;
      --local)
        # Use local binary instead of downloading
        LOCAL_BINARY="$2"
        if [[ -z "$LOCAL_BINARY" ]] || [[ ! -f "$LOCAL_BINARY" ]]; then
          print_error "Local mode requires path to binary: --local /path/to/promptcode"
        fi
        shift 2
        ;;
      --uninstall)
        # Open TTY file descriptor for interactive I/O (ignore failure)
        open_tty || true
        uninstall
        exit 0
        ;;
      --help|-h)
        HELP=true
        shift
        ;;
      *)
        print_error "Unknown option: $1"
        exit 1
        ;;
    esac
  done
  
  # Open TTY file descriptor for interactive I/O (ignore failure)
  open_tty || true
  
  # Simple, compact banner that works in narrow terminals (35 chars wide)
  echo "" >&2
  echo "  ╭───────────────────────────────╮" >&2
  echo "  │   PromptCode CLI Installer   │" >&2  
  echo "  ╰───────────────────────────────╯" >&2
  echo "" >&2

  # Show help if requested
  if [[ "$HELP" == "true" ]]; then
    echo "Usage: curl -fsSL <installer-url> | bash [OPTIONS]" >&2
    echo "" >&2
    echo "Options:" >&2
    echo "  --dry-run            Show what would be done without making changes" >&2
    echo "  --no-path            Skip PATH modifications (manual setup required)" >&2
    echo "  --local <path>       Use local binary instead of downloading" >&2
    echo "  --uninstall          Remove PromptCode CLI from your system" >&2
    echo "  --help, -h           Show this help message" >&2
    exit 0
  fi
  
  # Dry run mode notification
  if [[ "$DRY_RUN" == "true" ]]; then
    print_info "DRY RUN MODE - No changes will be made"
    echo "" >&2
  fi

  # Check if running as root (security and permission issues)
  if [[ $EUID -eq 0 ]]; then
    print_error "Please don't run this installer as root/sudo. Install for your user account instead."
    exit 1
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
    
    # Check if already up-to-date (idempotency)
    local latest_normalized=$(normalize_version "$version")
    if [[ "$current_version" == "$latest_normalized" ]] && [[ "$current_version_raw" != *"-dev."* ]]; then
      print_success "Already up to date!"
      exit 0
    fi
    
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
        local reply
        reply="$(safe_read_char "Run this command now? [Y/n] " "Y")"
        if [[ $reply =~ ^[Yy]$ ]] || [ -z "$reply" ]; then
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
        local reply
        reply="$(safe_read_char "Proceed with direct reinstall? [Y/n] " "Y")"
        if [[ ! $reply =~ ^[Yy]$ ]] && [ -n "$reply" ]; then
          print_info "Installation cancelled"
          exit 0
        fi
        # Continue with installation - will overwrite the broken version
      elif [[ "$current_version" == *"-dev."* ]]; then
        print_warning "This development version doesn't support update."
        print_info "Will force reinstall with latest release version ($version)"
        local reply
        reply="$(safe_read_char "Proceed with force reinstall? [Y/n] " "Y")"
        if [[ ! $reply =~ ^[Yy]$ ]] && [ -n "$reply" ]; then
          print_info "Installation cancelled"
          exit 0
        fi
        # Continue with installation - will overwrite the dev version
      else
        print_warning "This version doesn't support update. Manual reinstall required."
        local reply
        reply="$(safe_read_char "Proceed with manual reinstall? [Y/n] " "Y")"
        if [[ ! $reply =~ ^[Yy]$ ]] && [ -n "$reply" ]; then
          print_info "Installation cancelled"
          exit 0
        fi
      fi
    fi
  fi

  # Download binary or use local one
  local temp_binary=""
  if [[ -n "$LOCAL_BINARY" ]]; then
    # Use provided local binary
    print_info "Using local binary: $LOCAL_BINARY"
    temp_binary="$LOCAL_BINARY"
    # Extract version from binary if possible
    if "$temp_binary" --version &>/dev/null; then
      version="v$("$temp_binary" --version)"
      print_info "Detected version: $version"
    fi
  elif [[ "$DRY_RUN" == "true" ]]; then
    print_info "Would download ${CLI_NAME} ${version} for ${platform}"
    temp_binary="/tmp/dry-run-placeholder"
    touch "$temp_binary"  # Create placeholder for dry run
  else
    temp_binary=$(download_binary "$version" "$platform")
  fi

  # Check if binary exists
  if [ -z "$temp_binary" ] || [ ! -f "$temp_binary" ]; then
    print_error "Failed to get binary"
    exit 1
  fi

  # Install binary
  if [[ "$DRY_RUN" == "true" ]]; then
    print_info "Would install binary to ${INSTALL_DIR}/${CLI_NAME}"
    [[ "$temp_binary" == "/tmp/dry-run-placeholder" ]] && rm -f "$temp_binary"
  else
    install_binary "$temp_binary"
  fi

  # Check PATH
  if [[ "$NO_PATH" == "true" ]]; then
    print_info "Skipping PATH modification (--no-path flag used)"
    echo "" >&2
    echo "To use ${CLI_NAME}, add this to your shell configuration:" >&2
    echo "  export PATH=\"\$PATH:${INSTALL_DIR}\"" >&2
  elif [[ "$DRY_RUN" == "true" ]]; then
    print_info "Would update PATH in detected shell configuration files"
  else
    check_path
  fi

  echo "" >&2
  print_success "Installation complete! 🎉"
  
  # Automatically check for integrations
  echo "" >&2
  print_info "Checking for AI environment integrations..."

  # Run integration check with proper error handling
  # Since v0.6.30, the CLI handles TTY detection internally, so we don't need
  # complex TTY redirection that was causing kqueue errors on macOS
  local temp_err=$(mktemp 2>/dev/null || mktemp -t promptcode)
  local integrate_failed=false

  # Check if stdin is a TTY to decide how to run the command
  if [[ -t 0 ]]; then
    # Interactive mode - stdin is already a TTY, run normally
    if ! "${CLI_NAME}" integrate --auto-detect 2>"$temp_err"; then
      integrate_failed=true
    fi
  elif [[ -t 1 ]] || [[ -t 2 ]]; then
    # Piped mode but stdout or stderr is a TTY
    # Try to use /dev/tty directly for input/output
    # This allows prompts to work even when piped through curl
    if [ -e /dev/tty ]; then
      if ! "${CLI_NAME}" integrate --auto-detect </dev/tty >/dev/tty 2>"$temp_err"; then
        integrate_failed=true
      fi
    else
      # No TTY available at all, run in non-interactive mode
      if ! "${CLI_NAME}" integrate --auto-detect 2>"$temp_err"; then
        integrate_failed=true
      fi
    fi
  else
    # Fully non-interactive environment
    if ! "${CLI_NAME}" integrate --auto-detect 2>"$temp_err"; then
      integrate_failed=true
    fi
  fi

  # Check if integration failed
  if [[ "$integrate_failed" == "true" ]]; then
    local err_content=$(cat "$temp_err" 2>/dev/null || echo "")

    # Check for kqueue errors that should be fixed in v0.6.30+
    if echo "$err_content" | grep -q -E "(EINVAL.*kqueue|WriteStream.*tty|error:.*kqueue)" 2>/dev/null; then
      # These errors should be fixed in v0.6.30+
      # Don't show the warning since the user is already on a fixed version
      # Just silently continue
      :
    elif [[ -n "$err_content" ]]; then
      # Show other meaningful errors
      echo "$err_content" >&2
    fi
  fi

  # Clean up temp file
  rm -f "$temp_err"
  
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