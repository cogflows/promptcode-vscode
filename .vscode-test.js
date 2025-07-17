// @ts-check
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  files: 'out/test/**/*.test.js',
  mocha: {
    ui: 'tdd',
    timeout: 20000
  }
});