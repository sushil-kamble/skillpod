---
name: npm-pkg-expert
description: >
  Full lifecycle expert for NPM package development and publishing. Use this skill
  any time the user is working in a project that has a package.json — whether they're
  adding a feature, fixing a bug, running tests, versioning a release, writing a README,
  updating a CHANGELOG, or publishing to npm. Trigger on phrases like "publish the package",
  "bump the version", "ready to release", "run the workflow", "push the package", "update
  the changelog", "ship it", "what's the next step for my npm package", or when the user
  just finished implementing something in a library and asks what to do next. When in
  doubt, use this skill — it covers the full 8-step release gate, branch-aware publish
  logic (main/master only), conventional commits, Keep-a-Changelog format, semver
  decisions, README upkeep, license, and code quality review via diff.
---

# NPM Package Expert

## Before Anything Else

Check for `AGENTS.md` or `CLAUDE.md` in the repo root. If present, read them first — they
are the owner's specific overrides and take precedence over everything in this skill.

Then verify these files exist. If any are missing, create them before touching the workflow:

| File | Why it matters |
|------|----------------|
| `package.json` | Must have `name`, `version`, `description`, `main`/`exports`, `scripts`, `repository`, `license`, `keywords`, `files` — missing fields cause broken installs and poor discoverability |
| `README.md` | The storefront for your package — see README Standards below |
| `CHANGELOG.md` | Lets consumers know exactly what changed so they can decide whether to upgrade |
| `LICENSE` | Required for legal use; must match the `license` field in `package.json` (default: MIT) |
| `files` in `package.json` | Controls what gets published — without it, you risk shipping `src/`, test files, or secrets |

---

## README Standards

A README should sell the package in under 2 minutes of reading. Longer doesn't mean better — it means the reader gives up and moves on.

Use exactly this structure:

```markdown
# package-name

One sentence: what it does and why someone would want it.

## Install
\`\`\`
npm install package-name
\`\`\`

## Quick Start
Minimal working example for the most common use case only.

## API
Exported functions/classes with signatures and one-line descriptions.
Link to full docs if they live elsewhere.

## Contributing
Point to CONTRIBUTING.md or link to the issue tracker.

## License
MIT
```

Rules:
- No badges beyond CI status + npm version — badge soup signals neglect
- No walls of configuration options — link to docs instead
- Update whenever a public API is added, changed, or removed — README drift erodes trust

---

## CHANGELOG Standards

Follow [Keep a Changelog](https://keepachangelog.com). The `[Unreleased]` section is your
living notepad — every change lands here first, then gets promoted to a versioned entry at
release time. This lets consumers see what's coming and lets you review what you built.

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Added
- New public API or feature

### Changed
- Breaking or non-breaking change to existing behavior

### Fixed
- Bug fixes

### Removed
- Deprecated items that are now gone
```

---

## Versioning (Semantic Versioning)

Semver is a promise to your consumers. Breaking it silently destroys trust.

| Change type | Bump |
|-------------|------|
| Bug fix, internal refactor — no API change | `patch` → `0.0.X` |
| New feature, backwards-compatible | `minor` → `0.X.0` |
| Breaking change to existing API | `major` → `X.0.0` |

Always use `npm version patch|minor|major` — it bumps `package.json`, creates a git tag,
and commits atomically. Never edit the version field by hand.

---

## Git Commit Standards

Use [Conventional Commits](https://www.conventionalcommits.org/). This makes changelogs
automatable and gives future contributors (and future you) a scannable history.

```
<type>(<scope>): <short description>
```

Types: `feat` · `fix` · `docs` · `refactor` · `test` · `chore` · `build` · `ci` · `perf`

**Examples:**
- `feat(parser): add async iterator support`
- `fix(cli): handle missing config file gracefully`
- `docs: update README with v2 API examples`
- `chore: bump version to 1.3.0`

One commit per logical change. Mixed commits make bisecting and reverting painful.

---

## The 8-Step Release Workflow

Run every step in order. Do not skip. Do not proceed if a step fails — a broken step means
something is wrong that needs diagnosing, not bypassing.

### Step 1 — Lint

```bash
npm run lint
```

Fix all errors and warnings. If no `lint` script exists, look for `eslint`, `biome`,
`oxlint`, or `.eslintrc`/`biome.json` configs and run the tool directly.

For auto-fixable issues: `npm run lint -- --fix`, then re-run clean to confirm.

### Step 2 — Test

```bash
npm test
```

- All existing tests must pass
- **If new functionality was added**: write tests for it *before* running — happy path +
  at least one edge case + one failure/error case per new function
- Match the test file naming convention already in the repo (`*.test.ts`, `*.spec.ts`,
  `__tests__/*.ts`, etc.)
- If no test suite exists: set up `vitest`, `jest`, or Node's built-in `node:test` before
  adding any feature. Shipping untested public APIs is a reliability liability.

### Step 3 — Build

```bash
npm run build
```

Check that the output directory (`dist/`, `lib/`, etc.) is populated and that the
`main`/`exports`/`types` fields in `package.json` point to real files in the output.
Run `npm pack --dry-run` to preview exactly what would be published.

### Step 4 — Version & Changelog

1. Move everything from `[Unreleased]` in `CHANGELOG.md` to a new versioned entry with today's date
2. Add a fresh empty `[Unreleased]` section at the top
3. Run `npm version patch|minor|major` (use the table above to choose)
4. Confirm the version in `package.json` was updated
5. Confirm the git tag was created: `git tag --list | tail -5`

### Step 5 — Diff Review (Code Quality Gate)

```bash
git diff HEAD~1
```

Or for uncommitted changes: `git diff` and `git diff --staged`

This step exists because writing code and reviewing code are different mental modes.
Look for:
- **DRY violations** — repeated logic that should be a shared helper
- **Dead code** — unused imports, variables, or functions
- **Magic numbers/strings** — name them as constants
- **Missing error handling** at system boundaries (file I/O, network, user input)
- **Over-engineering** — abstractions that have no current use case
- **README drift** — did any public API change without a README update?

If issues are found: fix → re-lint → re-test → re-build, then continue.

### Step 6 — Final Verification

```bash
npm test && npm run build
```

Must pass clean, zero errors. This is the gate before pushing.

### Step 7 — Push

```bash
git push && git push --tags
```

Tags must be pushed separately — they are what npm, GitHub Releases, and changelogs
use as reference points.

### Step 8 — Publish (Main/Master Only)

**Check branch first:**

```bash
git branch --show-current
```

| Branch | Action |
|--------|--------|
| `main` or `master` | `npm publish` |
| Anything else | **Stop. Do not publish.** Merge to main via PR first. |

```bash
npm publish
# For scoped public packages:
npm publish --access public
```

Verify the publish landed: `npm info <package-name> version`

---

## Edge Cases

**`npm version` fails with "working tree not clean"**
Commit or stash all changes first — `npm version` requires a clean tree so the
version commit is isolated and meaningful.

**Tests fail after adding a new feature**
Don't skip or comment out tests. Diagnose whether the implementation or the test is wrong,
then fix the correct one. Never push with failing tests.

**Breaking change discovered mid-minor release**
Bump to major. Hiding a breaking change in a patch or minor violates the semver contract
and will break downstream consumers who trusted your version signal.

**Feature branch needs publishing urgently**
The answer is still: open a PR, merge to main, then publish from main. Branch publishes
create untraceable releases and bypass all review gates.

**Build output looks wrong (missing files, wrong entry point)**
Check `files` array and `main`/`exports`/`types` in `package.json`. Run
`npm pack --dry-run` to see exactly what the tarball contains.

---

## Quick Checklist

```
- [ ] AGENTS.md / CLAUDE.md read (if present)
- [ ] Baseline files exist (package.json, README, CHANGELOG, LICENSE)
- [ ] Step 1: Lint passes
- [ ] Step 2: Tests pass (new tests written for new functionality)
- [ ] Step 3: Build succeeds, output verified
- [ ] Step 4: CHANGELOG updated + npm version run + tag confirmed
- [ ] Step 5: Diff reviewed — DRY, no dead code, README current
- [ ] Step 6: npm test && npm run build passes clean
- [ ] Step 7: git push && git push --tags
- [ ] Step 8: npm publish — only if on main/master
```
