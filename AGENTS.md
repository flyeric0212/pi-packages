# AGENTS.md

Pi extension package that restyles the Pi TUI: Claude Code-style header, Codex-style editor, and a single-line metrics footer. All features install from one entry point: `extensions/index.ts`.

## Commands

```bash
npm test          # run tests
npm run typecheck # type-check the code
```

## Code layout

One folder per feature under `extensions/` (header, editor, footer, commands), with shared state in `state.ts`, constants in `config.ts`, and pure formatting helpers in `utils.ts`. Tests live in `tests/`.

## Rules

1. **Pi-native first.** Use only public APIs; wrap or compose native components instead of rebuilding them; take over no UI slots, commands, or tools owned by Pi or other extensions; touch nothing beyond what a feature requires — Pi's settings and session state stay untouched.
2. **Stay compatible.** Depend only on the stable public surface, keep installs fully reversible, and re-verify against Pi after every upgrade.
3. **Keep overhead near zero.** Formatting stays pure and reuses computed results (interned lines, fingerprint-keyed memos); high-frequency paths throttle; sessions build lazily and clean up fully on `/new`, `/resume`, `/reload`. Even necessary costs are minimized and documented (code comment or ADR).