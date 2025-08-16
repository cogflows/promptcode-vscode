import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function writeFileSafe(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

async function makeFixture(): Promise<string> {
  const root = path.join(os.tmpdir(), 'promptcode-vscode-fixture', String(process.pid));
  fs.rmSync(root, { recursive: true, force: true });

  // Small TS workspace with an ignored file
  writeFileSafe(path.join(root, 'src', 'a.ts'), `export const a = 1;\n`);
  writeFileSafe(path.join(root, 'src', 'b.ts'), `export function foo(){ return 42 }\n`);

  // Ignore semantics
  writeFileSafe(path.join(root, '.gitignore'), `dist/\nnode_modules/\n`);
  writeFileSafe(path.join(root, '.promptcode_ignore'), `src/b.ts\n`);

  // A tiny preset folder to be used by future tests
  fs.mkdirSync(path.join(root, '.promptcode', 'presets'), { recursive: true });
  writeFileSafe(
    path.join(root, '.promptcode', 'presets', 'tiny.patterns'),
    `# Tiny preset for tests\nsrc/**/*.ts\n!src/b.ts\n`
  );

  return root;
}

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './index'); // compiled tests entry
    const workspace = await makeFixture();

    // The `runTests` function returns the exit code from the test run.
    const exitCode = await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspace],
      extensionTestsEnv: {
        PROMPTCODE_TEST: '1',
        NO_COLOR: '1',
        VSCODE_TELEMETRY_DISABLED: '1'
      }
    });

    // Exit with the actual exit code from the test run. This is crucial for CI.
    // A non-zero exit code will fail the build if tests fail.
    process.exit(exitCode);

  } catch (err) {
    console.error('Failed to run VS Code tests', err);
    process.exit(1);
  }
}

main();