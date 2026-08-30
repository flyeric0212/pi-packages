# pi-packages

English | [简体中文](./README.zh-CN.md)

A modular collection of extensions for [Pi](https://pi.dev/).

## Packages

- **`pi-craft-tui`** (`src/pi-craft-tui`) — Claude Code-style header, Codex-style input, and a single-line metrics footer.
- **`pi-simple-permission`** (`src/pi-simple-permission`) — Lightweight permission guard extension for Pi.
- **`pi-auto-compact`** (`src/pi-auto-compact`) — Native-first context compaction with a configurable settled-run budget threshold.

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

Native-first context budget companion for Pi 0.84.4+. Active runs are never interrupted by this extension.

- **Native Mid-Run Ownership** — Pi handles threshold/overflow compaction between tool execution and the next assistant response, then continues the same run with rebuilt context.
- **Settled-Run Budget Threshold** — After `agent_settled`, the extension can compact early at a model-relative percentage (80% by default), before the next user task.
- **Abort-Safe Guards** — Skips aborted, failed, or length-limited runs and rechecks `ctx.isIdle()` plus pending messages before calling the public compaction API.
- **Fixed Quality Guidance** — Adds a small, non-configurable focus instruction to Pi's native structured summary so goals, unfinished files, decisions, next steps, and file lists remain complete.
- **Fail-Safe Degradation** — Uses official compaction outcome events and disables extension-triggered attempts after the first failure for the session; Pi native recovery remains active.
- **One Setting** — Only `triggerPercent` is configurable. It is loaded once per session from the global file and optional trusted-project override.

### Configuration Example (`config.json`)

```json
{
  "autoCompact": {
    "triggerPercent": 80
  }
}
```

`triggerPercent` accepts 50–95 and defaults to 80. Configuration is read once on session start; run `/reload` after changing it. Other legacy extension fields are ignored. Disable the package through Pi's package configuration instead of maintaining a second enable switch.

For seamless **active-run** compaction near a chosen budget, configure Pi itself. For example, a 272k model reaches roughly 80% when `reserveTokens` is `54400`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 54400,
    "keepRecentTokens": 20000
  }
}
```

`reserveTokens` is an absolute value, so review it when switching context-window sizes. The extension deliberately does not read or write Pi settings.

## Principles

- **Pi-native first.** Public APIs only; native components are wrapped or composed, never rebuilt; UI slots, commands, and tools owned by Pi or other extensions stay untouched.
- **Stay compatible.** Only the stable public surface, fully reversible installs, re-verified against every Pi upgrade.
- **Keep overhead near zero.** Pure formatting with reused results, throttled high-frequency paths, lazy per-session work and full cleanup; even necessary costs are minimized and documented.

## License

[MIT](./LICENSE)
