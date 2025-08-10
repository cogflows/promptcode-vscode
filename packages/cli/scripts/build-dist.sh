#!/bin/bash

# Build distribution binaries for PromptCode CLI
set -e

echo "🔨 Building PromptCode CLI distribution..."

# Clean previous builds
rm -rf dist-bin
mkdir -p dist-bin

# Build for different platforms
echo "📦 Building for macOS..."
bun build src/index.ts --compile --target=bun-darwin-x64 --outfile dist-bin/promptcode-darwin-x64
bun build src/index.ts --compile --target=bun-darwin-arm64 --outfile dist-bin/promptcode-darwin-arm64

echo "📦 Building for Linux..."
bun build src/index.ts --compile --target=bun-linux-x64 --outfile dist-bin/promptcode-linux-x64
bun build src/index.ts --compile --target=bun-linux-arm64 --outfile dist-bin/promptcode-linux-arm64

echo "📦 Building for Windows..."
bun build src/index.ts --compile --target=bun-windows-x64 --outfile dist-bin/promptcode-windows-x64.exe

# Create universal binary for macOS
echo "🔗 Creating macOS universal binary..."
lipo -create dist-bin/promptcode-darwin-x64 dist-bin/promptcode-darwin-arm64 -output dist-bin/promptcode-darwin-universal

# Create tarballs
echo "📚 Creating archives..."
cd dist-bin

tar -czf promptcode-darwin-universal.tar.gz promptcode-darwin-universal
tar -czf promptcode-linux-x64.tar.gz promptcode-linux-x64
tar -czf promptcode-linux-arm64.tar.gz promptcode-linux-arm64
zip promptcode-windows-x64.zip promptcode-windows-x64.exe

cd ..

echo "✅ Distribution build complete!"
echo ""
echo "Files created in dist-bin/:"
ls -la dist-bin/*.tar.gz dist-bin/*.zip