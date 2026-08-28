# pi-packages

English | [简体中文](./README.zh-CN.md)

A modular collection of extensions for [Pi](https://pi.dev/).

## Packages

- **`pi-craft-tui`** (`src/pi-craft-tui`) — Claude Code-style header, Codex-style input, and a single-line metrics footer.
- **`pi-simple-permission`** (`src/pi-simple-permission`) — Lightweight permission guard extension for Pi.
- **`pi-auto-compact`** (`src/pi-auto-compact`) — Context auto-compaction with mid-turn interrupt, accurate token pressure estimation, and auto-resume.

## Install

Use `pi config` to disable conflicting packages first.

```bash
# 1. Clone repository
git clone https://github.com/flyeric0212/pi-packages.git /path/to/pi-packages

# 2. Install extensions
pi install /path/to/pi-packages/src/pi-craft-tui
pi install /path/to/pi-packages/src/pi-simple-permission
pi install /path/to/pi-packages/src/pi-auto-compact
```

Then start a new Pi session or run `/reload`.

## pi-craft-tui Features

![Overview](./assets/overview.png)

**UI**

- **Header** — animated π logo (once per process), version, slogan, model, thinking effort, project directory
- **Editor** — Codex-style filled input with a bold `❯`; history keeps the same marker; `!` flips it to the bash-mode color
- **Footer** — one line: `model high · 126k/400k · cwd (main) · tok/s · CH87.3%`; other extensions' statuses render on the line above

**Interaction**

- **`/clear` & `/cls`** — fill the viewport visually; session untouched
- **`/stats`** — session card: token totals (↑↓R/W Σ), cache hit, cost, messages (prompts/responses/tool calls), tool breakdown, abnormal stops, Agent runtime cycles, and total branch time
- **Skill shortcuts** — `/name` runs a loaded skill (same as `/skill:name`); completion menus show short names
- **Slash commands** — leading command painted in theme accent; Enter completes a partial pick and submits only on exact match

## pi-simple-permission Features

A lightweight, deterministic, and transparent permission guard for Pi. Eliminates false-positive blocks on command wrappers (like `xargs`) and prevents annoying Subagent prompt interruptions.

> Currently targets Unix-like Bash environments such as macOS and Linux; native Windows PowerShell command checks are not yet supported.

- **Deterministic Rule Matching** — Wildcard (`*`) support with strict regex escaping and later-rule precedence (`findLast`).
- **Layered Wrapper Checks** — Recognizes common wrappers such as `xargs`, `sudo`, `env`, `timeout`, and shell `-c`; safe batches stay silent while dangerous inner commands still match policy.
- **Compound Command Checks** — Reviews pipelines, chained/background commands, and executable substitutions while ignoring single-quoted or escaped text.
- **Sensitive Path Protection** — Normalizes `~`, model-generated `@`, and relative paths for direct file tools, with explicit exemptions such as `*.env.example`.
- **Layered JSON Configuration** — Merges built-in defaults, global policy, and trusted project policy; invalid files produce diagnostics instead of silently opening access.

### Configuration Example (`config.json`)

```json
{
  "permission": {
    "*": "allow",
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },
    "bash": {
      "*": "allow",
      "rm -rf *": "deny",
      "sudo *": "ask",
      "git push*": "ask"
    },
    "external_directory": {
      "*": "allow",
      "~/.ssh/*": "deny"
    }
  }
}
```

Later specific rules win within a category, while exact `"*"` is always the fallback. Project policy is loaded only after Pi trusts the project. This extension is a lightweight accident-prevention policy, not a complete shell parser or sandbox; path rules cover direct file tools, while Bash and symlink isolation require a separate sandbox.

## pi-auto-compact Features

Automatic context window compaction extension for Pi. Manages context growth and prevents runaway token usage in long-running, multi-tool marathon turns.

- **Accurate Context Pressure** — Uses native `totalTokens` when available, otherwise computes `input + output + cacheRead + cacheWrite` so cached prompts and assistant output are both counted.
- **Mid-Turn & Turn-Boundary Interruption** — Uses `message_end` for marathon tool-call chains and `agent_end` when `interruptTurn` is disabled.
- **Automatic Continuation** — Automatically sends a continuation prompt after compaction completes so the assistant resumes execution without manual user intervention.
- **Thrashing & Loop Guards** — Includes growth debounce, failure disarming, and a three-failure session cutoff while preserving Pi's native overflow recovery.
- **Layered JSON Configuration & Hot Reload** — Supports global (`~/.pi/agent/extensions/pi-auto-compact/config.json`) and trusted project (`.pi/pi-auto-compact.json`) overrides with field-level fallback and `mtime`-based hot reload.

### Configuration Example (`config.json`)

```json
{
  "autoCompact": {
    "enabled": true,
    "triggerPercent": 80,
    "debounceTokens": 20000,
    "interruptTurn": true,
    "notifyOnly": false,
    "customInstructions": "Focus the summary on: 1) the current task goal and acceptance criteria; 2) unfinished changes with their exact file paths; 3) key decisions made and the rationale behind them; 4) concrete next steps. Keep <read-files>/<modified-files> complete and accurate. The summary body language may follow the conversation language.",
    "lang": "en"
  }
}
```

Only modified settings need to be specified; missing fields use built-in defaults. Pi's native threshold compaction remains a safety net and is cancelled only while this extension's own compaction is in flight; overflow recovery and manual `/compact` remain untouched.

## Principles

- **Pi-native first.** Public APIs only; native components are wrapped or composed, never rebuilt; UI slots, commands, and tools owned by Pi or other extensions stay untouched.
- **Stay compatible.** Only the stable public surface, fully reversible installs, re-verified against every Pi upgrade.
- **Keep overhead near zero.** Pure formatting with reused results, throttled high-frequency paths, lazy per-session work and full cleanup; even necessary costs are minimized and documented.

## License

[MIT](./LICENSE)
