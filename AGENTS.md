# AGENTS.md

Pi extension package that restyles the Pi TUI: Claude Code-style header, Codex-style editor, and a single-line metrics footer. All features install from one entry point: `extensions/index.ts`.

## Commands

```bash
npm test          # run tests
npm run typecheck # type-check the code
```

## Code layout

One folder per feature under `extensions/` (header, editor, footer, clear, skill-shortcuts, tool-preview), with shared state in `state.ts`, constants in `config.ts`, and pure formatting helpers in `utils.ts`. Tests live in `tests/`.

## Rules

1. Only use Pi's public APIs. Never take over UI slots, commands, or tools that Pi or other extensions own, and re-check after Pi upgrades.
2. Keep formatting/layout logic pure and tested; UI components stay thin.
3. Never modify Pi's settings or clear the terminal — `/clear` only fills the viewport visually, without touching the session.
4. The footer is always a single line in fixed slot order (model+thinking, context, cwd, tps, cache). Other extensions' temporary statuses render on the line above.
5. Clean up fully on session end: no duplicate installs or leftover timers after `/new`, `/resume`, or `/reload`.