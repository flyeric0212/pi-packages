# pi-craft-tui

English | [简体中文](./README.zh-CN.md)

A [Pi](https://pi.dev/) package that gives the TUI a Claude Code-style header, Codex-style input, and a single-line metrics footer. Requires Pi **0.84.2** or newer.

![Overview](./assets/overview.png)

## Install

Use `pi config` to disable other TUI packages first.

### Local extension folder

Place this folder in one of Pi's auto-discovery locations:

```text
# Global default (when PI_CODING_AGENT_DIR is unset)
~/.pi/agent/extensions/pi-craft-tui

# Project-specific
.pi/extensions/pi-craft-tui
```

### Git repository

Install for your user:

```bash
pi install git:github.com/flyeric0212/pi-craft-tui
```

Or only for the current project:

```bash
pi install -l git:github.com/flyeric0212/pi-craft-tui
```

Try it for one run without installing:

```bash
pi -e git:github.com/flyeric0212/pi-craft-tui
```

Then start a new Pi session or run `/reload`. This package does not write `settings.json` or set `quietStartup`.

## Features

**UI**

- **Header** — animated π logo (once per process), version, slogan, model, thinking effort, project directory
- **Editor** — Codex-style filled input with a bold `❯`; history keeps the same marker; `!` flips it to the bash-mode color
- **Footer** — one line: `model high · 126k/400k · cwd (main) · tok/s · CH87.3%`; other extensions' statuses render on the line above

**Interaction**

- **`/clear` & `/cls`** — fill the viewport visually; session untouched
- **Skill shortcuts** — `/name` runs a loaded skill (same as `/skill:name`); completion menus show short names
- **Slash commands** — leading command painted in theme accent; Enter completes a partial pick and submits only on exact match

## Principles

- **Pi-native first.** Public APIs only; native components are wrapped or composed, never rebuilt; UI slots, commands, and tools owned by Pi or other extensions stay untouched.
- **Stay compatible.** Only the stable public surface, fully reversible installs, re-verified against every Pi upgrade.
- **Keep overhead near zero.** Pure formatting with reused results, throttled high-frequency paths, lazy per-session work and full cleanup; even necessary costs are minimized and documented.

## License

[MIT](./LICENSE)
