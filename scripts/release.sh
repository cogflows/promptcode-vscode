#!/bin/bash
# Quick release helper

VERSION_TYPE=${1:-patch}  # patch, minor, or major

# Update version
npm version $VERSION_TYPE --no-git-tag-version

# Get the new version
VERSION=$(node -p "require('./package.json').version")

# Commit and tag
git add package.json package-lock.json
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"

# Push
echo "Ready to push v$VERSION. Continue? (y/n)"
read -r response
if [[ "$response" == "y" ]]; then
  git push origin main --follow-tags
  echo "✅ Pushed v$VERSION"
  echo ""
  echo "Next steps:"
  echo "1. Wait for GitHub Actions to build (~5 min)"
  echo "2. Test the artifacts from GitHub Release"
  echo "3. If good, promote:"
  echo "   gh workflow run promote-all.yml -f tag=v$VERSION"
  echo ""
  echo "4. If issues found, just run again:"
  echo "   ./scripts/release.sh patch"
else
  echo "Push cancelled. Tag created locally."
fi