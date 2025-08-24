#!/bin/bash
# Simple CSP violation checker for CI
# Catches 90% of CSP issues with basic grep

echo "Checking for CSP violations..."
VIOLATIONS=0

# Check both source and built output if available
DIRS="src/webview"
if [ -d "out/webview" ]; then
    DIRS="$DIRS out/webview"
fi

for DIR in $DIRS; do
    echo "Checking $DIR..."
    
    # Check for javascript: URLs
    if grep -r "javascript:" "$DIR" 2>/dev/null; then
        echo "❌ Found javascript: URLs in $DIR - these violate CSP"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
    
    # Check for inline event handlers (onclick, onchange, etc.)
    if grep -rE '\son[a-z]+\s*=' "$DIR" 2>/dev/null; then
        echo "❌ Found inline event handlers (onclick, onchange, etc.) in $DIR - these violate CSP"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
    
    # Check for eval usage
    if grep -rE '\beval\s*\(' "$DIR" 2>/dev/null; then
        echo "❌ Found eval() usage in $DIR - violates CSP"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
    
    # Check for Function constructor
    if grep -rE '\bnew\s+Function\s*\(' "$DIR" 2>/dev/null; then
        echo "❌ Found Function constructor in $DIR - violates CSP"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
    
    # Check for implied eval (setTimeout/setInterval with string as first arg)
    if grep -rE 'set(Timeout|Interval)\s*\(\s*["'\'']' "$DIR" 2>/dev/null; then
        echo "❌ Found setTimeout/setInterval with string in $DIR - implied eval violates CSP"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
done

if [ $VIOLATIONS -gt 0 ]; then
    echo ""
    echo "❌ Found $VIOLATIONS CSP violation(s)"
    exit 1
else
    echo "✅ No CSP violations found"
    exit 0
fi