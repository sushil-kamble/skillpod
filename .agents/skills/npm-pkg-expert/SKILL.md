---
name: npm-pkg-expert
description: >
  Expert guide for building, maintaining, and publishing high-quality NPM packages.
  Activate this skill whenever you are working inside an NPM package project — i.e.,
  the working directory contains a package.json intended for publishing to npm. This
  includes creating new packages, adding features, fixing bugs, cutting releases, or
  reviewing code quality. The skill enforces a full quality gate: lint → format → test
  → build → version → diff-review → publish (only on main). Use it proactively any
  time the user says things like "add a feature", "fix a bug", "release", "publish",
  "bump version", "update changelog", "write tests", "build the package", or when you
  notice you are editing files in a project that has a package.json with a "publishConfig"
  or "bin" field or a "prepublishOnly" script.
---

# NPM Package Expert

You are operating inside an NPM package project. Your job is to help ship high-quality,
well-documented, properly-versioned package code. Every change goes through a disciplined
quality gate before it reaches the registry.

---

## Package Health Checklist

Every well-maintained npm package should have these in place. Check and create/update
them whenever you touch the project:

| File                      | Purpose                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `package.json`            | Correct `name`, `version`, `description`, `main`/`exports`, `bin`, `files`, `engines` |
| `README.md`               | Sell the feature clearly and concisely — setup + usage, nothing more                  |
| `CHANGELOG.md`            | Keep a Changelog format (see below)                                                   |
| `LICENSE`                 | SPDX license file matching `package.json#license`                                     |
| `CLAUDE.md` / `agents.md` | Followed if present — these override your defaults                                    |

---

## The Quality Gate (run after every meaningful change)

Work through these steps in order. Do not skip steps, and do not move to the next
step until the current one passes.

### Step 1 — Lint

```bash
# Typically one of:
pnpm run lint     # or npm run lint / yarn lint
```

Fix all reported errors. For warnings, use judgment — fix anything that represents
a real issue, not just stylistic noise.

### Step 2 — Format

```bash
pnpm run format   # or equivalent
```

Formatting should be non-negotiable. If there is no format script, check for a
`.prettierrc` / `.eslintrc` and run the formatter directly.

### Step 3 — Tests

```bash
pnpm test         # or npm test
```

All existing tests must pass before you continue.

**If you added new functionality**, add tests for it now — before building. Tests
belong in the same iteration as the code they cover, not as a follow-up. Place
tests co-located with the module (`.test.ts` / `.spec.ts`) or in a `__tests__/`
directory, matching whatever convention is already in use.

A good test covers:

- The happy path
- At least one edge case or error path
- Any boundary conditions that are non-obvious

Re-run tests after adding new ones to confirm they all pass.

### Step 4 — Build

```bash
pnpm run build    # or npm run build
```

The build must succeed cleanly. Fix any compilation or bundling errors before
proceeding. Check that the `dist/` (or equivalent output) looks correct and that
no test files, source maps, or internal utilities leaked into it.

### Step 5 — Version & Changelog

Only bump the version when you are preparing a release. Do not bump the version
on every commit — only when the user is ready to publish.

**Versioning rules (Semantic Versioning — semver.org):**

| Change type                       | Version bump            |
| --------------------------------- | ----------------------- |
| Breaking change                   | major (`1.x.x → 2.0.0`) |
| New feature, backwards-compatible | minor (`x.1.x → x.2.0`) |
| Bug fix, patch, docs              | patch (`x.x.1 → x.x.2`) |

**Update these files together as a single commit:**

1. `CHANGELOG.md` — Add an entry at the top (see format below)
2. `package.json` — Bump `version`
3. Any other files that embed the version (e.g., a `src/version.ts`)

**CHANGELOG.md format (Keep a Changelog):**

```markdown
## [1.2.0] - 2026-03-18

### Added

- New `--watch` flag for live reloading

### Fixed

- Resolved edge case where config path was not resolved on Windows

### Changed

- `init` command now prompts for GitHub token interactively
```

Use sections: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
Keep entries human-readable and user-facing — describe the impact, not the implementation.

### Step 6 — Diff Review

Before committing, run a mental (and tool-assisted) pass over the full diff:

```bash
git diff          # unstaged
git diff --staged # staged
```

Ask yourself:

- **DRY**: Is any logic duplicated that could be extracted into a shared utility?
- **Simplicity**: Is there a shorter, clearer way to express this?
- **Correctness**: Are there off-by-one errors, unhandled null/undefined, missing await?
- **Side effects**: Does anything touch global state, the filesystem, or network unexpectedly?
- **Dead code**: Are there unused imports, variables, or commented-out blocks?

If you spot issues, fix them now and go back to Step 1.

### Step 7 — Final Verification

Run tests and build one more time to confirm the cleaned-up code still works:

```bash
pnpm test && pnpm run build
```

If both pass, you are ready to commit.

### Step 8 — Commit

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short description>

[optional body]

[optional footer — e.g. BREAKING CHANGE: ...]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`

Examples:

```
feat(cli): add --dry-run flag to init command
fix(config): resolve path on Windows when HOME contains spaces
chore: release v1.2.0
docs: update README setup instructions
```

Keep the subject line under 72 characters. Write in the imperative mood ("add" not "added").

### Step 9 — Push

```bash
git push
```

Push to the current branch's remote tracking branch.

---

## Branch-Aware Publishing

Publishing to npm is **only allowed from the `main` branch** (or `master`, if that
is the convention in this repo). This is a hard rule — it prevents accidental
releases from feature branches and keeps the published package history clean.

**Check your branch before publishing:**

```bash
git branch --show-current
```

| Branch                 | Allowed to publish?               |
| ---------------------- | --------------------------------- |
| `main` / `master`      | Yes — proceed with `pnpm publish` |
| Any feature/fix branch | No — push only, do not publish    |

**To publish (main branch only):**

```bash
# Confirm everything is clean
git status

# Dry run first — checks what would be included in the tarball
pnpm publish --dry-run

# If dry run looks correct:
pnpm publish
```

After publishing, tag the release:

```bash
git tag v<version>
git push --tags
```

---

## README Guidelines

The README is a sales page and a quickstart guide — nothing more. Keep it lean.

**Good README structure:**

```markdown
# package-name

One sentence: what it does and who it's for.

## Install

<install command>

## Usage

<minimal working example — real code, not pseudocode>

## API

<only if the surface area is non-trivial>

## License
```

**Rules:**

- No wall-of-text explaining implementation details — link to docs instead
- No badges unless they add real information (CI status is useful; random shields are not)
- Keep examples runnable — copy-pasteable and correct
- **Update the README whenever you change public API, add commands, or change the setup steps.** Do this in the same commit as the code change, not as a follow-up

---

## License

If a `LICENSE` file is missing, ask the user which license they want (MIT is the
common default for open-source npm packages). Create the file with the correct
SPDX text and add `"license": "MIT"` (or appropriate) to `package.json`.

---

## Edge Cases

- **Tests fail after your changes**: Fix the failing tests before proceeding. Do not
  comment them out or skip them.
- **Build produces unexpected output**: Check `files` in `package.json` and the build
  config. Never ship `src/`, test files, or source maps unless the package is a library
  that explicitly benefits from them.
- **On a detached HEAD**: Warn the user and do not push or publish until on a named branch.
- **Version already exists on npm**: Do not re-publish. Bump the patch version and try again.
- **`prepublishOnly` script fails**: Fix the underlying issue (usually lint, test, or build).
  Never bypass it with `--ignore-scripts`.
- **No test script defined**: Flag this to the user. Suggest adding one with the project's
  existing test runner, or set up `node:test` / `vitest` / `jest` as appropriate.
- **CLAUDE.md or agents.md present**: Read them first. Their conventions override the
  defaults in this skill.
