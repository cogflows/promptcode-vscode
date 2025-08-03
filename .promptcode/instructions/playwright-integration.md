# Playwright Browser Automation Integration for PromptCode CLI

## Objective
Implement a new command `promptcode browser` that uses Playwright to automate interactions with AI chat interfaces (starting with ChatGPT), enabling seamless code generation workflows directly from the terminal.

## Requirements

### Core Functionality
1. **New Command**: `promptcode browser <action>`
   - Actions: `chat`, `send`, `extract`, `apply`
   - Support for different AI platforms (initially ChatGPT, extensible to Claude, Gemini, etc.)

2. **Browser Automation Flow**:
   ```bash
   # Example workflow
   promptcode generate -f "src/**/*.ts" -o context.md
   promptcode browser chat --platform chatgpt --send context.md
   promptcode browser extract --wait-for-response -o response.md
   promptcode diff response.md --apply
   ```

3. **Platform Support**:
   - Start with ChatGPT (chat.openai.com)
   - Extensible architecture for adding other platforms
   - Platform-specific selectors and interaction patterns

### Technical Implementation

1. **New Package Structure**:
   - Create `packages/browser` or add to `packages/cli/src/commands/browser/`
   - Use Playwright for browser automation
   - TypeScript with proper error handling

2. **Key Features**:
   - **Authentication handling**: Store and reuse browser context
   - **Smart waiting**: Detect when AI has finished responding
   - **Code extraction**: Intelligently extract code blocks from chat responses
   - **Session management**: Maintain conversation context
   - **Error recovery**: Handle network issues, timeouts, etc.

3. **Command Structure**:
   ```typescript
   promptcode browser chat [options]
     --platform <name>      Platform to use (chatgpt, claude, gemini)
     --profile <name>       Browser profile to use (for auth persistence)
     --headless             Run in headless mode (default: false for debugging)
     --send <file>          Send file content as prompt
     --wait-timeout <ms>    Max wait time for response (default: 60000)
   
   promptcode browser extract [options]
     --wait-for-response    Wait for AI to finish responding
     --selector <css>       Custom selector for response area
     --out <file>           Output file for extracted content
   
   promptcode browser apply [options]
     --from <file>          File containing AI response
     --preview              Preview changes before applying
   ```

4. **Platform Configuration**:
   ```typescript
   interface PlatformConfig {
     name: string;
     url: string;
     selectors: {
       input: string;
       sendButton: string;
       responseArea: string;
       codeBlocks: string;
       isTypingIndicator?: string;
     };
     actions: {
       waitForReady: () => Promise<void>;
       sendMessage: (text: string) => Promise<void>;
       waitForResponse: () => Promise<void>;
       extractResponse: () => Promise<string>;
     };
   }
   ```

5. **Implementation Priorities**:
   - Phase 1: Basic ChatGPT integration with manual auth
   - Phase 2: Response extraction and code parsing
   - Phase 3: Session persistence and profile management
   - Phase 4: Multi-platform support

### Error Handling
- Network timeouts
- Authentication failures
- Element not found errors
- Rate limiting
- Session expiration

### User Experience
- Clear progress indicators
- Verbose mode for debugging
- Dry-run options
- Integration with existing `context` and `diff` commands

### Testing Strategy
- Mock browser interactions for unit tests
- Integration tests with real browser (optional)
- Platform-specific test cases
- Error scenario testing

## Success Criteria
1. Can send a prompt to ChatGPT and extract the response
2. Can parse code blocks from AI responses
3. Can apply extracted code using existing `diff` command
4. Supports persistent browser sessions
5. Graceful error handling and recovery
6. Clear documentation and examples

## Future Enhancements
- Support for multiple AI platforms
- Conversation management (continue existing chats)
- Automatic context splitting for large prompts
- Response streaming for long outputs
- Integration with VS Code extension
- API mode for platforms that support it