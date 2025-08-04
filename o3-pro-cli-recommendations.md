Below is a “punch-list” that will move PromptCode CLI from “power-user oriented” to “zero-friction” for both humans and autonomous agents.

─────────────────────────────────────────────────────────
1.  INTUITIVE, “ONE-SHOT” SYNTAX
─────────────────────────────────────────────────────────
Status-quo:   promptcode expert "How can I …" -f "src/**/*.ts"
Pain: agent had to discover sub-commands, flags and presets.

Proposal: introduce a single primary verb ask (or make it the default
when no verb is supplied).  Positional arguments are parsed left-to-right:

    promptcode [ask] <question?> [<file_or_glob …>] [--model o3-pro]

Quick rules

• If the first positional token contains a space OR ends with ? it is
  treated as the question.
• Anything that matches an existing file/dir or contains * ? […] is
  treated as a pattern.
• The traditional flags (-f, --preset, etc.) continue to work.

Examples that should “just work”

a) Entire repo:
    promptcode "What are the security risks?"

b) Explicit files:
    promptcode "Refactor suggestions?" api.py utils/*.py

c) Using @ prefix (Gemini-style):
    promptcode ask @src/ @docs/ "Generate high-level overview"

d) Question last (fallback):
    promptcode src/**/*.ts "What is the API surface?"

Implementation sketch (src/index.ts):

```ts
const defaultCmd = async (args: string[], opts: GlobalOpts) => {
  const { question, patterns } = parsePositional(args);
  await expertCommand(question, { files: patterns, ...opts });
};

program
  .argument('[...inputs]', '')
  .action(defaultCmd);
```

Helper parsePositional():

```ts
function parsePositional(tokens: string[]) {
  let questionParts: string[] = [];
  let patterns: string[] = [];
  for (const t of tokens) {
    const looksLikeFile = /[\\/*?\[\]]/.test(t) || fs.existsSync(t.replace(/^@/, ''));
    if (looksLikeFile) patterns.push(t.replace(/^@/, ''));
    else questionParts.push(t);
  }
  const question = questionParts.join(' ').trim();
  return { question, patterns };
}
```

─────────────────────────────────────────────────────────
2.  ZERO-CONFIG / PRESET-LESS WORKFLOW
─────────────────────────────────────────────────────────
• If positional patterns are supplied we instantly skip the preset layer.
• Missing patterns → default to **/* with .gitignore respected.
• A temporary “inline preset” is assembled in-memory; token cache keys
  already include the absolute path so no extra work required.
• Remove the “you must supply --preset OR -f” error branch.

Edge cases & guidance
• If >500 files selected, print: “Tip ▶ Consider a preset: promptcode
  save-preset backend **/*.ts …”

─────────────────────────────────────────────────────────
3.  SUPPORT @ PREFIX
─────────────────────────────────────────────────────────
Reason: Gemini and many prompt-runner UIs adopted “@” inclusion syntax.
Add one-liner in scanFiles() wrapper:

```ts
patterns = patterns.map(p => p.startsWith('@') ? p.slice(1) : p);
```

─────────────────────────────────────────────────────────
4.  KISS: COVER 80 % WITH 20 % INPUT
─────────────────────────────────────────────────────────
• Default command is ask (expert).  generate/preset remain for power-users.
• Defaults:
  – model: use first available key (OpenAI → Anthropic → …) else o3-mini.
  – output: stdout with terser header (“── AI Response ──”).
  – maxTokens is autocomputed (contextWindow-safetyMargin).

Self-explanatory behaviour
• Unknown flag?  Show 3-line cheat-sheet not full help.
• Missing API key?  Show:  promptcode config --set-openai-key <key>

Successful precedents
• git, docker, gh accept “commandless” forms (e.g.  git status).
• fly.io, ngrok default to “launch” with sane assumptions.
Pattern: one canonical verb + sub-commands for niche flows.

─────────────────────────────────────────────────────────
5.  IMPLEMENTATION PRIORITY & MIGRATION PLAN
─────────────────────────────────────────────────────────
1. QUICK WINS (≤1 day)
   a. parsePositional() and default action (keeps full backward-compat).
   b. “@” stripping.
   c. Improve error when no question supplied: “I need a question, e.g.
      promptcode \"How do I …\" src/*.ts”.

2. MID-TERM (1-3 days)
   a. Auto-select first configured provider key.
   b. Inline preset + friendly large-selection tip.
   c. Short error → “Did you mean: promptcode ‘question’ file1 file2”.

3. LONG-TERM (optional, >3 days)
   a. Deprecate explicit generate/expert in v1.0; keep aliases.
   b. Interactive TUI (ala git add -p) for file selection when no
      patterns given AND terminal is TTY.

Backward compatibility
• No existing script breaks because sub-commands remain.
• Only additive behaviour; mark new parsing as “smart-mode” in CHANGELOG.

─────────────────────────────────────────────────────────
6.  ENHANCED ERROR / HELP MESSAGES
─────────────────────────────────────────────────────────
Bad: “unknown option ‘@backend/…’”
Good: 

```
🙋 It looks like you tried to pass file paths directly.
   Try:  promptcode "YOUR QUESTION" @backend/…
   Or see  promptcode --help-short
```

Implement --help-short that prints four usage lines.

─────────────────────────────────────────────────────────
7.  SECURITY & PERFORMANCE NOTES
─────────────────────────────────────────────────────────
• Do not auto-read >10 MB per file unless --force-large.
• When creating inline presets, write nothing to disk → avoid race
  conditions from concurrent agent instances.
• Keep SAFETY_MARGIN (256) but compute dynamic chunking if context >
  model window (road-map).

─────────────────────────────────────────────────────────
EXAMPLE AGENT SESSION AFTER CHANGES
─────────────────────────────────────────────────────────
Agent:  promptcode "Why is the Slack curator timing out?" @backend/slack_kb/ async_eager_curator.py

→ CLI prints:

1. “Scanning 1 file (1 234 tokens) …”
2. “Consulting O3 Pro …”
3. AI answer
4. “Done (cost $0.0004)”

No presets, no multiple help calls.  Mission accomplished.

─────────────────────────────────────────────────────────
TL;DR
Add a smart default “ask” pathway that treats the CLI like a natural
language function: prompt + files.  Support '@' aliases, auto-detect
provider, and tighten help/errors.  These minimal, backwards-compatible
changes will remove 90 % of the friction AI agents experienced.