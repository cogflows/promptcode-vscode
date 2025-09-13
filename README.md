# PromptCode

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/v/release/cogflows/promptcode-vscode)](https://github.com/cogflows/promptcode-vscode/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/cogflows/promptcode-vscode/total)](https://github.com/cogflows/promptcode-vscode/releases)
[![Platform](https://img.shields.io/badge/Platform-VSCode%20%7C%20CLI-blue)](https://github.com/cogflows/promptcode-vscode)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-blue)](https://marketplace.visualstudio.com/items?itemName=cogflows.promptcode)
[![CLI Tool](https://img.shields.io/badge/CLI-Available-green)](https://github.com/cogflows/promptcode-vscode/releases/latest)

> **The ultimate rescue tool when AI code agents hit their limits**

PromptCode is your go-to solution when code agents like Cursor or Windsurf hit a wall. Available as both a powerful [VS Code extension](https://marketplace.visualstudio.com/items?itemName=cogflows.promptcode) and a standalone [CLI tool](https://github.com/cogflows/promptcode-vscode/tree/main/packages/cli#readme), PromptCode supercharges your workflow with improved code-to-AI connections. It seamlessly bridges your codebase with your favorite AI models—including those without direct API access, like GPT-5 or Grok. Pick your file context, craft precise prompt templates, generate AI prompts, and even parse the responses—whether you prefer the rich VS Code interface or the flexibility of the command line.

## Demo Video

Watch this short demo to see PromptCode in action:

[![PromptCode Video](https://img.youtube.com/vi/dUpdSAPklfo/0.jpg)](https://www.youtube.com/watch?v=dUpdSAPklfo)

## Quick Start

Choose your path:

### VS Code Extension
1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cogflows.promptcode)
2. Open Command Palette (`Cmd/Ctrl+Shift+P`) → "PromptCode: Show"
3. Select files, add instructions, generate prompts

### CLI Tool
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.ps1 | iex

# Quick test
promptcode expert "Explain this code" src/**/*.ts
```

## Why PromptCode?

When your trusty code agent stumbles, PromptCode steps in as the ultimate rescue tool. Its unique strength lies in bridging the gap between your codebase and AI models, offering a structured, intuitive way to:

- **Select specific files** as context for your prompts
- **Add custom instructions** or use prompt templates for clarity
- **Two ways to work**: Rich VS Code UI or powerful CLI—your choice
- **Work with any AI model**, even those tricky non-API ones
- **Parse and apply AI responses** directly to your code, implement yourself, or paste the response to your AI code agent

No more fumbling with scattered tools or manual context copying—PromptCode keeps it all in one place, right where you code.

## Key Features

### 🔍 Smart Context Selection
- **Intuitive File Picker**: Hand-pick files from your workspace to give your AI the exact context it needs
- **Intelligent Filtering**: Quickly filter relevant files with smart search and .gitignore/.promptcode_ignore support
- **Token Optimization**: See real-time token counts to maximize your context window

### ✏️ Instruction Builder
- **Custom Templates**: Built-in prompt templates for common coding tasks (refactoring, bug fixing, optimization, etc.)
- **@mention System**: Quickly insert templates with our `@` mention system (type @ in the instructions field)
- **Workspace Templates**: Create your own project-specific templates in `.promptcode/prompts`

### 💬 Universal AI Compatibility
- **Copy & Paste**: Works with ANY AI model or assistant - including Anthropic Claude, OpenAI GPT-4, Google Gemini, and others
- **No API Required**: Use with desktop models (Claude 3 Opus Local, GPT-5, Grok, etc.) or private instances
- **Supplement Your Workflow**: Perfect companion to Cursor, Windsurfninja, GitHub Copilot, and other AI coding tools

### 🔄 Structured Output Processing
- **Code Change Extraction**: Automatically parse code changes from AI responses
- **Smart Code Diff**: Preview changes with side-by-side diffs before applying
- **Bulk Apply**: Apply multiple file changes with a single click

### 🚀 CLI Features
- **Expert Mode**: Direct AI consultation with codebase context
- **Preset Management**: Save and reuse file selection patterns
- **Cost Controls**: Budget caps, dry-run mode, and approval workflows
- **IDE Integration**: Works alongside Claude Code and Cursor
- **Auto-Updates**: Keep CLI current with `promptcode update`

## Supported AI Models

PromptCode works with the latest AI models from major providers:

- **OpenAI**: GPT-5 family (standard, mini, nano), GPT-4o series
- **Anthropic**: Claude Opus-4, Sonnet-4, Haiku-4
- **Google**: Gemini 2.5 Pro/Flash, Gemini 2.0 Flash
- **xAI**: Grok-4, Grok-Beta

Run `promptcode models` to see all available models and their capabilities.

## Usage

### VS Code Extension Workflow

1. **Select Files**: Open the PromptCode view and use the file explorer to choose the files you want as context.
2. **Add Instructions**: Switch to the Instructions tab, type @ to pull up prompt templates, or write custom directions.
3. **Generate Prompt**: Review your polished prompt in the Generate Prompt tab—copy it or open it in the editor.
4. **Apply Changes**: Paste the AI's response in the Merge tab to review and apply suggested edits effortlessly.

### CLI Workflow

```bash
# Create a reusable preset for your API files
promptcode preset create api --from-files "src/api/**/*.ts" "src/models/**/*.ts"

# Get expert consultation with preset context
promptcode expert "How can I optimize these database queries?" --preset api

# Generate a prompt for external use
promptcode generate --preset api --template refactor -o prompt.txt

# Direct file analysis
promptcode expert "Review for security issues" src/auth/*.ts --model gpt-5
```

## Configuration

Tailor PromptCode to your needs with these options:

- **Ignore Patterns**: Define which files to skip when selecting context (e.g., node_modules/ or .git/).
- **Prompt Folders**: Point to directories housing your custom prompt templates for quick access (e.g., .cursorrule, ai-docs).

## Installation

Choose the tool that fits your workflow—or use both!

### VS Code Extension

Install from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cogflows.promptcode) or search for "PromptCode" in VS Code Extensions.

**Features:**
- Visual file selection with tree view
- Real-time token counting
- Built-in prompt templates
- AI response parsing and diff view
- Settings sync across devices

### CLI Tool

Perfect for terminal workflows, automation, and CI/CD pipelines.

#### Quick Install
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.sh | bash

# Windows PowerShell  
irm https://raw.githubusercontent.com/cogflows/promptcode-vscode/main/packages/cli/scripts/install.ps1 | iex
```

#### Update & Uninstall
```bash
promptcode update      # Self-update to latest version
promptcode uninstall   # Remove CLI and clean up
```

**Features:**
- Expert Mode: Direct AI consultation with codebase context
- Preset Management: Save and reuse file selection patterns
- Template Support: Apply structured prompts for common tasks
- Multi-Model Support: Works with OpenAI, Anthropic, Google, and xAI models
- IDE Integration: Set up integrations with Claude Code and Cursor

See the [CLI documentation](packages/cli/README.md) for detailed usage and examples.

## Telemetry

PromptCode collects anonymous usage data (which features are used and any errors encountered) to improve the extension. This respects VS Code's telemetry settings and can be disabled via `promptcode.enableTelemetry` setting. No personal data, file contents, prompts, or code are ever collected.

## Copyright 

© 2025 cogflows. All Rights Reserved.