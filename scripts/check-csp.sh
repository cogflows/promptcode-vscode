#!/bin/bash
# Simple CSP violation checker for CI
# Catches 90% of CSP issues with basic grep

echo "Checking for CSP violations..."

# Check for javascript: URLs
if grep -r "javascript:" src/webview 2>/dev/null; then
    echo "❌ Found javascript: URLs - these violate CSP"
    exit 1
fi

# Check for inline event handlers (onclick, onchange, etc.)
if grep -rE '\son[a-z]+\s*=' src/webview 2>/dev/null; then
    echo "❌ Found inline event handlers (onclick, onchange, etc.) - these violate CSP"
    exit 1
fi

# Check for eval or implied eval
if grep -rE 'eval\s*\(|new\s+Function\s*\(|setTimeout\s*\([^,]+,[[:space:]]*["'"'"']' src/webview 2>/dev/null; then
    echo "❌ Found eval or implied eval - these violate CSP"
    exit 1
fi

echo "✅ No CSP violations found"