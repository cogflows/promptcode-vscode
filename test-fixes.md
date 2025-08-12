# Test Plan for Critical Fixes

This document outlines the test scenarios to verify all critical fixes from issue #6.

## Test Environment Setup
1. Open VS Code with the PromptCode extension
2. Open a project with multiple directories and files
3. Ensure `.promptcode_ignore` file can be created

## Test Scenarios

### 1. Search Expand Bug Fix ✅
**Test:** Search for files and verify directories expand
- [ ] Type a search term that matches files in nested directories
- [ ] Verify matching directories automatically expand
- [ ] Clear search and verify tree collapses properly

### 2. Search Debouncing ✅
**Test:** Type quickly in search box
- [ ] Type multiple characters rapidly
- [ ] Verify search doesn't trigger for each keystroke
- [ ] Verify 200ms debounce delay works
- [ ] No stuttering or UI freezing

### 3. Path-Aware Search ✅
**Test:** Search using path patterns
- [ ] Search for `src/components` - should find path matches
- [ ] Search for `test*.ts` - should find glob pattern matches
- [ ] Search for simple filename - should still work

### 4. Tri-State Checkboxes ✅
**Test:** Select files in directories
- [ ] Select one file in a directory
- [ ] Parent should show mixed/indeterminate state
- [ ] Select all files in directory
- [ ] Parent should show fully checked
- [ ] Deselect all files
- [ ] Parent should show unchecked

### 5. Ignore Persistence ✅
**Test:** Edit and save ignore patterns
- [ ] Open ignore configuration UI
- [ ] Add new ignore patterns
- [ ] Save configuration
- [ ] Verify `.promptcode_ignore` file is created/updated
- [ ] Restart extension and verify patterns persist

### 6. Core Integration ✅
**Test:** Generate prompt with selected files
- [ ] Select multiple files from different directories
- [ ] Generate prompt
- [ ] Verify `<file_tree>` shows correct relative paths
- [ ] No garbled or incorrect paths

### 7. Tests Pass ✅
**Test:** Run test suite
- [ ] `npm test` runs without errors
- [ ] All test assertions pass
- [ ] No import errors
- [ ] No type mismatches

## Performance Checks
- [ ] Large repository (1000+ files) search is responsive
- [ ] Selection of many files doesn't freeze UI
- [ ] Token counting completes in reasonable time

## Regression Checks
- [ ] Basic file selection still works
- [ ] Copy path commands work correctly
- [ ] Multi-root workspace support intact
- [ ] Existing prompts still generate correctly

## Acceptance Criteria Summary
✅ All critical bugs fixed
✅ Search is fast and responsive
✅ UI accurately reflects selection state
✅ Configuration persists correctly
✅ Tests pass