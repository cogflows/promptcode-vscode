// Centralized asset naming to avoid drift across scripts and update logic.
// Standardization decision:
//   Windows: promptcode-win-<arch>.exe (x64|arm64)
//   Linux:   promptcode-linux-<arch>   (x64|arm64)
//   macOS:   promptcode-darwin-<arch>  (x64|arm64)
//
// If future SKUs are added, extend maps here and reuse.

type NodePlatform = 'win32' | 'linux' | 'darwin';
type NodeArch = 'x64' | 'arm64' | 'x86';

const SUPPORTED_ARCH: Record<string, NodeArch> = {
  x64: 'x64',
  amd64: 'x64',
  arm64: 'arm64',
  aarch64: 'arm64',
  x86: 'x86',
  ia32: 'x86',
};

export function normalizeArch(arch: string): NodeArch {
  const key = String(arch || '').toLowerCase();
  const norm = SUPPORTED_ARCH[key];
  if (!norm) {
    throw new Error(`Unsupported architecture: ${arch}`);
  }
  return norm;
}

export function getAssetName(platform: NodePlatform, archInput: string): string {
  const arch = normalizeArch(archInput);
  
  // Check for x86 on Windows (not supported)
  if (platform === 'win32' && arch === 'x86') {
    throw new Error('32-bit Windows (x86) is not supported. Please use a 64-bit system.');
  }
  
  switch (platform) {
    case 'win32':
      return `promptcode-win-${arch}.exe`;
    case 'linux':
      return `promptcode-linux-${arch}`;
    case 'darwin':
      return `promptcode-darwin-${arch}`;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export function getExpectedBinaryName(platform: NodePlatform, archInput: string): string {
  // For now matches the release asset names.
  return getAssetName(platform, archInput);
}

export function isWindows(platform = process.platform): boolean {
  return platform === 'win32';
}

export function isMac(platform = process.platform): boolean {
  return platform === 'darwin';
}

export function isLinux(platform = process.platform): boolean {
  return platform === 'linux';
}