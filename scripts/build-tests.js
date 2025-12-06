const esbuild = require('esbuild');
const { existsSync } = require('fs');
const path = require('path');

// Build test files
console.log('Building test files...');

const testEntryPoints = [
  'src/test/index.ts',
  'src/test/runTests.ts',
  'src/test/filePattern.test.ts',
  'src/test/generatePatternsFromSelection.test.ts',
  'src/test/smoke.test.ts',
  'src/test/migration.test.ts',
  'src/test/promptContract.test.ts',
  'src/test/promptWorkspaceMetadata.test.ts',
  'src/test/ignorePatterns.test.ts',
  'src/test/extensionActivation.test.ts',
  'src/test/tokenCounter.test.ts',
  'src/test/suite/fileExplorer.test.ts',
  'src/test/suite/fileExplorerCheckbox.test.ts',
  'src/test/suite/fileExplorerSearch.test.ts',
  'src/test/suite/fileExplorerDecorationWebviewBug.test.ts',
  'src/test/suite/fileExplorerSearchCheckboxBug.test.ts',
  // Also compile the utils that tests depend on
  'src/utils/filePattern.ts',
  'src/utils/generatePatternsFromSelection.ts',
  'src/promptcodeDataFetcher.ts',
  // Compile modules that tests import directly
  'src/fileExplorer.ts',
  'src/ignoreHelper.ts',
  'src/constants.ts'
];

// Filter out any test files that don't exist
const existingTestFiles = testEntryPoints.filter(file => {
  const fullPath = path.join(process.cwd(), file);
  return existsSync(fullPath);
});

if (existingTestFiles.length === 0) {
  console.log('No test files found to build');
  process.exit(0);
}

esbuild.build({
  entryPoints: existingTestFiles,
  bundle: false, // Don't bundle test files
  outdir: 'out',
  outbase: 'src', // Preserve directory structure
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  preserveSymlinks: true,
  define: {
    'process.env.NODE_ENV': '"test"'
  }
}).then(() => {
  console.log('Test files built successfully');
}).catch((error) => {
  console.error('Error building test files:', error);
  process.exit(1);
});
