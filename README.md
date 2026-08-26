# pi-craft-tui

English | [简体中文](./README.zh-CN.md)

A [Pi](https://pi.dev/) package that gives the TUI a Claude Code-style header, Codex-style input, and a single-line metrics footer. Requires Pi **0.84.2** or newer.

![Overview](./assets/overview.png)

## Install

Use `pi config` to disable other TUI packages first.

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

- Header: animated Pi logo (once per new process), version, slogan, model, thinking effort, and project directory
- Editor: Codex-style filled input with a bold `❯`
- Footer: `model high · 126k/400k · cwd · tok/s · CH87.3%`; cache hit is the branch-cumulative rate, last, and hidden until a cache read; other extensions' `setStatus()` text appears on the line above
- `/clear` and `/cls` clear the screen only
- `/skill-name` runs a loaded skill (same as `/skill:skill-name`)
- Slash commands: the command name uses the theme accent; Enter completes a partial pick and only submits when the typed name already matches

## License

[MIT](./LICENSE)
