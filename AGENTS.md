# AGENTS.md

## Project

SkillPod — CLI tool (`skillpod`) for managing personal agent skills registries via GitHub. npm package: [`skillpod`](https://www.npmjs.com/package/skillpod).

## Stack

TypeScript, ESM, Node.js >=18, Commander.js (CLI), Octokit (GitHub API), simple-git, Inquirer (prompts), Chalk, Ora.

## Architecture

Layered: `commands/` (thin CLI wrappers) → `core/` (business logic) → `utils/` (cross-cutting). All core functions use **dependency injection** — accept optional `dependencies` param with interface-typed services for testability.

## Conventions

- ESM with `.js` import extensions. Named exports only.
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Node.js native test runner (`node:test`, `node:assert/strict`). Co-located `*.test.ts` files.
- Tests use `createTempDirTracker()`, `createSilentLogger()`, `createRecordingLogger()`, `createSilentSpinnerFactory()` from `test-utils/shared.ts`.
- No source maps, no declarations in published package (CLI, not library).
- Semantic versioning. Changelog follows Keep a Changelog format.

## Commands

- `pnpm run build` — clean + compile + chmod
- `pnpm test` — run all tests
- `pnpm run lint` / `pnpm run format:check` — code quality
