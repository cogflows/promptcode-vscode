import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000 // 10 second timeout
  });

  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((c, e) => {
    glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
      if (err) {
        return e(err);
      }

      // Add files to the test suite
      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

      try {
        // Run the mocha test
        mocha.run(failures => {
          if (failures > 0) {
            e(new Error(`${failures} tests failed.`));
          } else {
            c();
          }
          // In CI, we need to exit the process after tests complete
          // This is safe because @vscode/test-electron manages the lifecycle
          if (process.env.CI) {
            setTimeout(() => {
              process.exit(failures > 0 ? 1 : 0);
            }, 100);
          }
        });
      } catch (err) {
        console.error(err);
        e(err);
      }
    });
  });
}