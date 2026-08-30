# AGENTS.md

Pi extension workspace (`pi-packages`) containing multiple modular packages:
- `pi-craft-tui` (`src/pi-craft-tui`): Claude Code-style header, Codex-style editor, and a single-line metrics footer. Entry point: `src/pi-craft-tui/index.ts`.
- `pi-simple-permission` (`src/pi-simple-permission`): Simple permission guard extension for Pi. Entry point: `src/pi-simple-permission/index.ts`.
- `pi-auto-compact` (`src/pi-auto-compact`): Native-first context compaction extension; Pi owns active-run compaction, while the extension applies a configurable budget threshold after `agent_settled`. Entry point: `src/pi-auto-compact/index.ts`.

## Commands

```bash
npm test          # run tests across packages
npm run typecheck # type-check the code
```

## Packages

Packages are organized under `src/`:
- `src/pi-craft-tui/`: TUI styling and interactive enhancements. Internal features structured in folders (`header`, `editor`, `footer`, `commands`), with shared state in `state.ts`, constants in `config.ts`, and pure formatting helpers in `utils.ts`. Tests live in `src/pi-craft-tui/tests/`.
- `src/pi-simple-permission/`: Permission guard package. Tests live in `src/pi-simple-permission/tests/`.
- `src/pi-auto-compact/`: Minimal native-first context compaction package. `index.ts` owns settled-run safety and Pi event wiring; `config.ts` loads the single `triggerPercent` setting once per session. Tests live in `src/pi-auto-compact/tests/`.

## Rules

1. **Pi-native first.** Use only public APIs; wrap or compose native components instead of rebuilding them; take over no UI slots, commands, or tools owned by Pi or other extensions; touch nothing beyond what a feature requires — Pi's settings and session state stay untouched.
2. **Stay compatible.** Depend only on the stable public surface, keep installs fully reversible, and re-verify against Pi after every upgrade.
3. **Keep overhead near zero.** Formatting stays pure and reuses computed results (interned lines, fingerprint-keyed memos); high-frequency paths throttle; sessions build lazily and clean up fully on `/new`, `/resume`, `/reload`. Even necessary costs are minimized and documented (code comment or ADR).
