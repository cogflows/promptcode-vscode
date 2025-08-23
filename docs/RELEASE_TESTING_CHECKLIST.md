# Pre-Release Testing Checklist

## Purpose
This checklist ensures critical functionality is tested before each release to prevent bugs like Issue #17 (CSP violations breaking the UI).

## Automated Testing
Before manual testing, ensure all automated tests pass:

- [ ] Unit tests: `npm run test:unit`
- [ ] CLI tests: `cd packages/cli && bun test`
- [ ] Webview tests: `npm run test:webview`
- [ ] CSP compliance tests: `npx playwright test csp-compliance.spec.ts`
- [ ] Interaction tests: `npx playwright test interactions.spec.ts`
- [ ] ESLint (including CSP rules): `npm run lint`

## Manual Testing in VS Code

### Environment Setup
- [ ] Test in VS Code stable version
- [ ] Test in VS Code Insiders version
- [ ] Open Developer Console (Help > Toggle Developer Tools)
- [ ] Check for any red errors or CSP violations in console

### Core Functionality

#### File Selection UI
- [ ] Open PromptCode view
- [ ] **Expand/collapse folders in file tree** ✅
- [ ] **Select/deselect files via checkboxes** ✅
- [ ] Select all files button works
- [ ] Deselect all files button works
- [ ] Search for files works
- [ ] Clear search works
- [ ] File count updates correctly

#### Configuration
- [ ] Toggle "Respect .gitignore" checkbox
- [ ] Add ignore patterns
- [ ] Save .promptcode_ignore file
- [ ] Verify patterns are applied

#### Presets
- [ ] Load existing presets
- [ ] Apply a preset
- [ ] Save current selection as preset
- [ ] Re-apply preset works

#### Tab Navigation
- [ ] Switch between all tabs (Select Files, Instructions, Generate, Apply)
- [ ] Each tab content loads properly
- [ ] No console errors when switching tabs

#### Prompt Generation
- [ ] Generate prompt with selected files
- [ ] Token count displays correctly
- [ ] Copy to clipboard works
- [ ] Export to file works

### Console Monitoring
Throughout testing, monitor the console for:
- [ ] No CSP violations
- [ ] No uncaught errors
- [ ] No failed network requests
- [ ] No security warnings

### Performance
- [ ] UI remains responsive with 100+ files selected
- [ ] Search doesn't lag with large file trees
- [ ] Token counting doesn't freeze UI

## Browser/Webview Specific

### Content Security Policy
- [ ] Check console for any CSP violations:
  - Look for: "Refused to execute inline event handler"
  - Look for: "Refused to load script"
  - Look for: "Refused to apply inline style"
- [ ] Verify all scripts have proper nonce attributes
- [ ] No inline onclick, onchange, or other event handlers

### Cross-platform Testing
- [ ] Test on Windows
- [ ] Test on macOS
- [ ] Test on Linux

## Regression Testing
Verify previously fixed issues don't reoccur:
- [ ] Issue #17: File selection UI responds to clicks (no CSP violations)
- [ ] Issue #15: Stats command doesn't hang on large repos
- [ ] Issue #6: Search expands matching directories

## Sign-off
- [ ] All automated tests pass
- [ ] Manual testing completed without issues
- [ ] No console errors or warnings
- [ ] Performance is acceptable
- [ ] Cross-platform testing done (or scheduled)

**Tester:** _________________  
**Date:** _________________  
**Version:** _________________  
**Notes:** _________________

## If Issues Found
1. Do NOT proceed with release
2. Create GitHub issue with:
   - Steps to reproduce
   - Console error messages
   - Screenshots if applicable
   - VS Code version
   - OS version
3. Fix issues and restart checklist

## Post-Release Monitoring
- [ ] Monitor GitHub issues for 24 hours
- [ ] Check VS Code marketplace reviews
- [ ] Verify telemetry (if enabled) shows no errors