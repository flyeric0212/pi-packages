# pi-packages

English | [简体中文](./README.zh-CN.md)

A modular collection of extensions for [Pi](https://pi.dev/).

## Packages

- **`pi-craft-tui`** (`src/pi-craft-tui`) — Claude Code-style header, Codex-style input, and a single-line metrics footer.
- **`pi-simple-permission`** (`src/pi-simple-permission`) — Lightweight permission guard extension for Pi.

## Install

Use `pi config` to disable conflicting packages first.

```bash
# 1. Clone repository
git clone https://github.com/flyeric0212/pi-packages.git /path/to/pi-packages

# 2. Install extensions
pi install /path/to/pi-packages/src/pi-craft-tui
pi install /path/to/pi-packages/src/pi-simple-permission
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
- **`/stats`** — session card: token totals (↑↓R/W Σ), cache hit, turns, elapsed time
- **Skill shortcuts** — `/name` runs a loaded skill (same as `/skill:name`); completion menus show short names
- **Slash commands** — leading command painted in theme accent; Enter completes a partial pick and submits only on exact match

## Principles

- **Pi-native first.** Public APIs only; native components are wrapped or composed, never rebuilt; UI slots, commands, and tools owned by Pi or other extensions stay untouched.
- **Stay compatible.** Only the stable public surface, fully reversible installs, re-verified against every Pi upgrade.
- **Keep overhead near zero.** Pure formatting with reused results, throttled high-frequency paths, lazy per-session work and full cleanup; even necessary costs are minimized and documented.

## License

[MIT](./LICENSE)
