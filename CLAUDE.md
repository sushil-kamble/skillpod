# SkillPod

CLI for authoring and managing personal agent skills registries, backed by GitHub.

Published on npm as [`skillpod`](https://www.npmjs.com/package/skillpod).

## Architecture

```
src/
  commands/   → Commander.js command definitions (thin wrappers)
  core/       → Business logic (config, skills CRUD, git ops, GitHub API, init wizard)
  utils/      → Cross-cutting utilities (logger, spinner, editor, UI, clipboard)
  types/      → TypeScript interfaces
  test-utils/ → Shared test fixtures and stubs
```

**Flow**: `Command → Core function → Service interfaces → External deps`

## Key Conventions

- **ESM-only** (`"type": "module"`). All imports use `.js` extensions.
- **Dependency injection** everywhere. Core functions accept an optional `dependencies` parameter with interface-typed services. Defaults bind to real implementations; tests pass stubs.
- **Named exports** only (no default exports).
- **Node.js native test runner** (`node:test` + `node:assert/strict`), run via `tsx --test`. Each module has a co-located `.test.ts` file.
- **Strict TypeScript**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` enabled.
- **No source maps or declarations in dist** — this is a CLI tool, not a library.

## Commands

```bash
pnpm run build     # clean + tsc + chmod
pnpm test          # run all tests
pnpm run lint      # eslint
pnpm run format    # prettier write
```

## Testing Patterns

- `createTempDirTracker()` for temp directories, cleaned in `afterEach`.
- `createSilentLogger()` / `createRecordingLogger()` for log capture (strips ANSI).
- `createSilentSpinnerFactory()` for no-op spinners.
- Dynamic imports with cache-busting (`?test=${Date.now()}`) for modules that read `HOME`.

## Release Process

1. Update `CHANGELOG.md` (Keep a Changelog format).
2. Bump version in `package.json`.
3. Commit: `chore: release vX.Y.Z`.
4. Tag: `git tag vX.Y.Z`.
5. Push: `git push && git push --tags`.
6. Publish: `pnpm publish` (runs `prepublishOnly` → build + test).

## Rules

- Never publish source maps, declarations, or test-utils to npm.
- Validate skill names with regex before any filesystem ops.
- User-facing errors are descriptive messages, not stack traces.
- Config lives at `~/.skillpod/config.json` with `0o600` permissions — never commit it.
