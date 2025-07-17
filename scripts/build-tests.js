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
  // Also compile the utils that tests depend on
  'src/utils/filePattern.ts',
  'src/utils/generatePatternsFromSelection.ts'
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