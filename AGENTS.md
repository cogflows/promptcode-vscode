# Repository Guidelines

## Project Structure & Module Organization
PromptCode ships a VS Code extension in `src/` and shared logic under `packages/core/src/`. The standalone CLI lives in `packages/cli/src/` with tests in `packages/cli/test/`. Extension-focused UI assets sit under `src/webview/` with styles isolated in `src/webview/styles/`. CI workflows and release automation are kept in `.github/workflows/`.

## Build, Test, and Development Commands
Run `npm run compile` for a development build of the extension, or `npm run build:prod` for production bundles. Use `npm run watch` while iterating and `npm run lint` to enforce formatting and static analysis. Execute `npm test` at the root for the full suite. For CLI work, `cd packages/cli && bun run build` creates the binary and `bun test` runs Bun-powered tests.

## Coding Style & Naming Conventions
TypeScript and JavaScript follow the repository ESLint config with 2-space indentation. Keep CSS in dedicated files within `src/webview/styles/`; avoid inline styles in webview scripts. Shared utilities favor descriptive camelCase function names, while command files in the CLI use kebab-case filenames to mirror command names.

## Testing Guidelines
Run `npm test` to exercise the VS Code integration harness via `vscode-test`. Drive webview coverage with `npm run test:webview` (Playwright) and rebuild extension tests through `npm run compile:tests` when adding fixtures. CLI tests live beside fixtures under `packages/cli/test/`; execute them with `npm run test:cli` or `bun test` and name new files `*.test.ts`. Set `PROMPTCODE_TEST=1` when crafting CLI tests that would otherwise prompt or hit the network.

## Commit & Pull Request Guidelines
Follow Conventional Commit prefixes observed in history (`fix:`, `chore:`, `feat:`) and keep subjects under 72 characters. Each PR should describe functional changes, mention affected packages or commands, and link issues when applicable. Include CLI output or screenshots for user-facing UI tweaks to ease review.

## Security & Configuration Tips
Store provider credentials through environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`. Respect local `.gitignore` rules when adding samples, and avoid committing generated binaries from `packages/cli/dist/` unless updating release artifacts.
