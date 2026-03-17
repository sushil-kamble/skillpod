# skill-forge - Implementation Plan

**Goal**: A TypeScript CLI that gives developers a first-class authoring and management workflow for their personal agent skills registry, backed by a GitHub repo and compatible with the skills.sh ecosystem.

**Stack**: TypeScript, Node.js, Commander.js (CLI framework), Octokit (GitHub API), simple-git (git operations), Inquirer.js (interactive prompts), `npx skills` (install bridge)

**MVP Scope**:

- In: init, create, list, edit, remove, push, sync, install commands
- In: GitHub repo as registry (auto-create or manual point)
- In: Full skills.sh SKILL.md format compatibility
- Out: Web UI
- Out: Multi-registry (subscribing to others' registries)
- Out: Skill versioning/tagging beyond git history
- Out: Private/encrypted skills

**Execution Model**: Autonomous AI agent. Assume environment is configured. Skip setup.

---

## Architecture Snapshot

5 major components:

**CLI Layer** (`src/commands/`) — Commander.js command definitions. Each command is a thin handler that delegates to the core layer. No business logic here.

**Core Layer** (`src/core/`) — All business logic: skill CRUD, git operations, GitHub API calls, config management. Commands call core functions; core functions are independently testable.

**Config Store** (`~/.skill-forge/config.json`) — Persists: GitHub token, registry repo URL, local clone path, GitHub username. Loaded once at CLI startup, written on init/configure.

**Local Registry** (`~/.skill-forge/registry/` by default, configurable) — A git clone of the user's GitHub skills repo. All skill files live here. Every write operation modifies files in this directory; push syncs to GitHub.

**skills.sh Bridge** — `install` and `sync` commands spawn `npx skills add <username>/skills` as a child process. No vendoring of skills CLI logic — just delegate to it.

Data flow: CLI command → Core function → reads/writes Local Registry files → git operations on Local Registry → GitHub remote. Install path: Core function → spawns `npx skills add` → skills.sh handles agent-specific installation.

---

## Phase 1: Project Scaffold + CLI Skeleton

**Objective**: A publishable npm package with a working `skill-forge` binary, proper TypeScript config, and stub commands that print their name when called.

### Package Structure

The package must be structured for npm publishing from day one. Entry point is `dist/index.js`. Binary declared in `package.json` under `bin.skill-forge`. Source in `src/`, compiled to `dist/`. Include `.npmignore` excluding `src/` and test files.

### CLI Entry + Command Registration

Commander.js root program with version pulled from `package.json`. Register these commands as stubs: `init`, `create`, `list`, `edit`, `remove`, `push`, `sync`, `install`. Each stub logs `[command]: not yet implemented`. Global `--debug` flag that enables verbose logging throughout the CLI.

### Config Module

Implement `src/core/config.ts` with `loadConfig()` and `saveConfig()`. Config file lives at `~/.skill-forge/config.json`. `loadConfig()` returns a typed config object; returns sensible defaults (empty strings, null) if the file doesn't exist — never throws on missing config. `saveConfig()` creates the directory if it doesn't exist before writing.

### Logging Utility

A thin `src/utils/logger.ts` wrapping `console` with `info`, `success`, `warn`, `error`, `debug` levels. Debug only outputs when `--debug` flag is active. Use chalk for color: green for success, red for error, yellow for warn, gray for debug.

### Edge Cases to Handle

- `~/.skill-forge/` directory doesn't exist on first run: config module creates it automatically
- `package.json` version read fails (missing field): fall back to `"unknown"` not a crash
- User runs `skill-forge` with no subcommand: show help, exit 0

### Production Considerations

Binary must be executable (`chmod +x` in build step). TypeScript strict mode on. All config file I/O wrapped in try/catch with descriptive error messages.

### Verification

- [ ] `npm run build` completes with 0 TypeScript errors
- [ ] `node dist/index.js --version` prints the version from package.json
- [ ] `node dist/index.js init` prints `[init]: not yet implemented`
- [ ] `node dist/index.js --debug list` prints debug output + stub message
- [ ] `node dist/index.js` with no args prints help and exits 0
- [ ] `loadConfig()` called when `~/.skill-forge/` doesn't exist returns defaults without throwing

**Gate**: Do not proceed until all verification items pass.

---

## Phase 2: Init Flow

**Objective**: `skill-forge init` fully configures a new user — GitHub auth, registry repo (auto-created or manually pointed), local clone — and writes config. After this phase, a user goes from zero to a working local registry in one command.

### GitHub Token Prompt

Prompt the user for a GitHub Personal Access Token (PAT) with `repo` scope. Display the GitHub URL for creating a PAT in the prompt message. Validate the token immediately by calling `GET /user` via Octokit — if it fails, show a clear error and re-prompt (max 3 attempts, then exit with instructions). On success, store the token and derived `githubUsername` in config.

### Registry Setup — Two Paths

After auth, ask the user to choose:

**Option A — Auto-create**: Create a public GitHub repo named `skills` under their account with a README and description. No name prompt — the repo name is always `skills`. Clone it to the local registry path. If a repo named `skills` already exists on their account, error with a clear message suggesting they use Option B to point at it instead.

**Option B — Manual point**: Prompt for the full GitHub repo URL (HTTPS format). Validate it's a real, accessible repo by calling `GET /repos/:owner/:repo`. Clone it to the local registry path. If the repo has existing files, that's fine — the user is adopting an existing skill collection.

### Local Registry Initialization

After clone, ensure the local directory has a `skills/` subdirectory. If it doesn't exist, create it and commit a `.gitkeep` with message `chore: initialize skills directory`. This guarantees the expected structure regardless of whether it was a fresh repo or an existing one.

### Config Write

Write `githubToken`, `githubUsername`, `registryRepoUrl`, `localRegistryPath` to config. `registryRepoName` is always `skills` — hardcoded, not configurable. Print a success summary showing the repo URL (`https://github.com/<username>/skills`) and local path.

### Edge Cases to Handle

- Token entered has insufficient scopes (`repo` missing): detect via Octokit error, tell the user exactly which scope to add
- Auto-create: GitHub API rate limited: surface the error, tell user to try again
- Clone fails (network, bad URL, no access): clean up any partially cloned directory, show error
- `skill-forge init` run a second time when config already exists: ask "already initialized, reinitialize?" — yes overwrites, no exits
- Local registry path already exists as a non-git directory: error and tell the user to remove it manually

### Production Considerations

Never log the GitHub token, not even in debug mode. Mask it as `***` if it appears in any output. Clone uses HTTPS not SSH to avoid requiring SSH key setup.

### Verification

- [ ] `skill-forge init` with a valid PAT and Option A creates a GitHub repo named `skills` and clones it locally
- [ ] `skill-forge init` with a valid PAT and Option B clones an existing repo
- [ ] After init, `~/.skill-forge/config.json` contains all five fields, token is not empty
- [ ] `skill-forge init` with an invalid PAT shows an error and re-prompts
- [ ] `skill-forge init` run again on an initialized system prompts for confirmation
- [ ] Cloned repo contains a `skills/` directory

**Gate**: Do not proceed until all verification items pass.

---

## Phase 3: Skill Authoring Commands

**Objective**: `create`, `list`, `edit`, `remove` are fully functional. A user can author and manage their skills locally.

### `skill-forge create <name>`

Accepts a skill name as argument. If omitted, prompts for it. Validate: lowercase, hyphens only, no spaces, no special characters — error clearly if invalid. Create a directory at `<localRegistryPath>/skills/<name>/` containing a `SKILL.md` file pre-populated with the standard frontmatter template:

```markdown
---
name: <name>
description:
  [Describe what this skill does and when the agent should activate it]
---

# <Title>

## When to Use

[Describe the scenarios where this skill applies]

## Instructions

[Step-by-step or behavioral instructions for the agent]

## Edge Cases

[What the agent should do when things don't go as expected]
```

After creating the file, open it in `$EDITOR` (fallback to `nano`, then `vi`). Print the file path on exit so the user knows where it lives.

### `skill-forge list`

Read all subdirectories under `<localRegistryPath>/skills/`. For each, parse the `SKILL.md` frontmatter. Display as a formatted table: name, description (truncated to 60 chars), last modified date (from file mtime). If no skills exist, print a helpful empty state message with the `create` command hint. Handle the case where a skill directory exists but `SKILL.md` is missing or has malformed frontmatter — show it in the list as `[invalid]` rather than crashing.

### `skill-forge edit <name>`

Resolve the skill directory. If name is omitted, show an interactive fuzzy-select list of existing skills (Inquirer.js). Open `SKILL.md` in `$EDITOR`. If the skill doesn't exist, error with suggestions (show similar names if any).

### `skill-forge remove <name>`

Resolve the skill. Show the skill's name and description, then ask for confirmation: "Remove skill '<name>'? This cannot be undone locally (but remains in git history). [y/N]". On confirm, delete the directory. On cancel, exit 0.

### Edge Cases to Handle

- `create` with a name that already exists: prompt "skill already exists, open for editing? [y/N]" rather than overwriting silently
- `list` when `skills/` directory is missing: create it, show empty state
- `edit` when `$EDITOR` is not set and fallbacks aren't found: print the file path and tell the user to open it manually
- `remove` on a name with no exact match: show close matches, ask if they meant one of them
- Frontmatter parse failure in `list`: show skill as `[invalid - check frontmatter]`, never crash the whole list

### Production Considerations

Never auto-push on create/edit/remove. Local changes stay local until the user explicitly runs `push`. This gives users a review step before anything hits GitHub.

### Verification

- [ ] `skill-forge create fastapi-structure` creates `skills/fastapi-structure/SKILL.md` with correct frontmatter
- [ ] `skill-forge create INVALID NAME` errors with a clear validation message
- [ ] `skill-forge list` shows the newly created skill with name and description
- [ ] `skill-forge list` with no skills shows empty state with hint
- [ ] `skill-forge edit fastapi-structure` opens the file in `$EDITOR`
- [ ] `skill-forge remove fastapi-structure` asks for confirmation, deletes on confirm
- [ ] `skill-forge remove nonexistent` shows a clear "not found" error
- [ ] A `SKILL.md` with missing `name` frontmatter shows as `[invalid]` in list, not a crash

**Gate**: Do not proceed until all verification items pass.

---

## Phase 4: GitHub Sync (Push + Pull)

**Objective**: `push` and `sync` are functional. Local changes get to GitHub; remote changes get to local. The registry is always in a consistent git state.

### `skill-forge push`

Run `git status` on the local registry. If nothing to commit, print "Registry is up to date" and exit 0. Otherwise show a summary of changed/added/removed skills (parse git status output into human-readable form — not raw git output). Prompt: "Push these changes? [Y/n]". On confirm: `git add -A`, `git commit -m "chore: update skills [timestamp]"`, `git push origin main`. On success, print the GitHub repo URL. On failure, print the git error with context.

Support `--message` / `-m` flag to override the commit message.

### `skill-forge sync`

Pull latest from remote: `git pull origin main`. Handle merge conflicts explicitly — if a conflict is detected, stop and tell the user to resolve it manually in the registry directory, then re-run sync. After successful pull, print a summary of what changed (new skills, modified skills, removed skills) by parsing git log.

### Git State Guard

Both `push` and `sync` must check that the local registry is a valid git repo with a configured remote before doing anything. If not, print a clear error telling the user to run `skill-forge init`.

### Edge Cases to Handle

- `push` with no internet: git error is caught, shown with a "check your connection" hint
- `push` when remote has changes the local doesn't: detect ahead/behind state before pushing, suggest running `sync` first
- `sync` results in a fast-forward (no conflicts): silent success, show summary
- `sync` results in a merge conflict: stop, print exact file paths with conflicts, tell the user what to do
- First push on a freshly auto-created repo where remote is empty: should work cleanly since the repo was cloned from GitHub
- Commit message with special characters passed via `-m`: sanitize before passing to git

### Production Considerations

Never expose the GitHub token in git remote URLs in any log output. Use credential helper or token embedded in remote URL only — mask it in all user-visible output.

### Verification

- [ ] Create a skill, run `skill-forge push` — GitHub repo shows the new skill directory
- [ ] Run `skill-forge push` with no changes — prints "up to date", no git commit created
- [ ] `skill-forge push -m "my custom message"` uses the custom message as commit message
- [ ] Manually add a file to the GitHub repo via GitHub UI, then `skill-forge sync` — local registry receives the change
- [ ] `skill-forge sync` with a conflict prints the conflicting file path and instructions
- [ ] Running either command outside an initialized registry shows a clear error

**Gate**: Do not proceed until all verification items pass.

---

## Phase 5: Install Bridge

**Objective**: `skill-forge install` and `skill-forge install --global` delegate to the skills.sh CLI to install the user's skills into their active coding agents.

### `skill-forge install`

Resolve the install target from config as `<githubUsername>/skills` — always. Spawn `npx skills add <githubUsername>/skills` as a child process with stdio inherited (so the skills.sh interactive prompts flow through directly to the user's terminal). Wait for exit. If exit code is non-zero, surface the error. On success, print a summary: "Your skills are now available in your agents."

Support `--skill <name>` flag that passes through to `npx skills add` as `--skill <name>`, allowing the user to install a single skill instead of all.

Support `--global` / `-g` flag that passes `-g` to the underlying `npx skills add` call (installs to user scope, not project scope).

Support `--agent` / `-a` flag that passes through to target a specific agent.

### `skill-forge install --list`

Spawn `npx skills add <githubUsername>/skills --list` and let the output flow through. This shows the user what skills are available in their registry from the skills.sh perspective.

### Pre-install Check

Before spawning, verify `<githubUsername>/skills` exists on GitHub via a quick `GET /repos/:owner/skills` check. If the repo is empty or has no skills, warn the user before proceeding (they may have forgotten to push).

### Edge Cases to Handle

- `npx` not available in PATH: catch the spawn error, tell the user to install Node.js
- Registry repo is private: skills.sh CLI won't be able to fetch it. Detect that the repo is private from config or GitHub API and warn the user that skills.sh requires a public repo
- User has no agents installed (skills.sh will prompt them): let it flow through — don't try to intercept or pre-handle this
- `--skill` value doesn't match any skill in registry: skills.sh will handle the error — let it flow through

### Production Considerations

skills.sh telemetry will run as part of the spawned process. Don't suppress it — it's the mechanism that makes skills show up on skills.sh leaderboard, which is a benefit to the user.

### Verification

- [ ] `skill-forge install` spawns `npx skills add <username>/skills` and passes through interactive output
- [ ] `skill-forge install --skill fastapi-structure` spawns with `--skill fastapi-structure` appended
- [ ] `skill-forge install` on a registry with no pushed skills shows a warning before spawning
- [ ] `skill-forge install` on a private repo shows a warning that skills.sh requires public repos
- [ ] `skill-forge install --list` shows the available skills from the registry

**Gate**: Do not proceed until all verification items pass.

---

## Phase 6: npm Publish + Production Readiness

**Objective**: `skill-forge` is published to npm, installable globally via `npm install -g skill-forge`, and the full user journey works end-to-end on a clean machine.

### npm Package Hygiene

Verify `package.json` has: `name`, `version`, `description`, `bin`, `main`, `files` (only `dist/`), `engines` (Node >= 18), `repository`, `keywords` including `skills`, `agent-skills`, `skill-forge`. Add `prepublishOnly` script that runs build + tests.

### First-run Experience

When any command other than `init` is run and config doesn't exist, print a clear onboarding message: "skill-forge not initialized. Run `skill-forge init` to get started." and exit 1.

### `skill-forge doctor`

Add a diagnostic command that checks: config file exists and is valid, local registry path exists and is a git repo, GitHub token is still valid (live API check), remote is reachable, `npx` is available in PATH. Print a pass/fail for each check. This is the first thing to tell a user to run when something breaks.

### Error Handling Audit

Walk every command and verify: no unhandled promise rejections, all Octokit calls have catch handlers with user-facing messages, all git operations have catch handlers, all file I/O has catch handlers. Error messages must include: what failed, what to try next.

### Edge Cases to Handle

- Node version below 18: detect on startup, print error with upgrade instructions, exit 1
- Config file is valid JSON but missing required fields (partial config from a failed init): treat as uninitialized, direct to `skill-forge init`
- `skill-forge doctor` when GitHub API is down: mark the API check as "unreachable", don't crash

### Production Readiness

- [ ] All external calls (GitHub API, git, npx spawn) have error handling with informative messages
- [ ] GitHub token never appears in any log output at any verbosity level
- [ ] `skill-forge --help` and `skill-forge <command> --help` show accurate, complete help text
- [ ] Running any command before init shows a clear onboarding message, not a crash
- [ ] `skill-forge doctor` passes all checks on a properly initialized machine

### Verification

- [ ] `npm install -g skill-forge` on a clean machine installs the binary
- [ ] Full journey on clean machine: `skill-forge init` → `skill-forge create test-skill` → `skill-forge push` → `skill-forge install` — all succeed
- [ ] `skill-forge doctor` shows all green on an initialized machine
- [ ] `skill-forge doctor` shows clear failures on an uninitialized machine
- [ ] `npm run prepublishOnly` passes with 0 errors
- [ ] Unhandled rejection test: kill network mid-push — error is caught and shown, process exits cleanly

**Gate**: Do not proceed until all verification items pass.

---

## Production Readiness

### Error Handling

- [ ] All GitHub API calls caught with messages that include what the call was trying to do
- [ ] All git operations caught — never expose raw git stderr to the user without context
- [ ] All file I/O caught — missing files, permission errors surface as actionable messages
- [ ] No unhandled promise rejections anywhere in the codebase

### Input/Output Safety

- [ ] Skill name validation enforced at CLI boundary (Phase 3 rule: lowercase + hyphens only)
- [ ] GitHub token masked in all output including debug logs
- [ ] Commit messages sanitized before passing to git

### Auth & Access

- [ ] Token stored only in `~/.skill-forge/config.json` (user-local, not project-level)
- [ ] Token validated on init, `doctor` command re-validates on demand
- [ ] Config file permissions should be 600 — set explicitly after write

### Resilience

- [ ] `push` is safe to re-run — if nothing changed, no commit is created
- [ ] `sync` detects conflict state and stops rather than making it worse
- [ ] All commands that modify state ask for confirmation before doing so

### Observability

- [ ] `--debug` flag enables verbose logging across all commands
- [ ] `skill-forge doctor` provides a single-command health snapshot
- [ ] All errors include enough context to understand what was happening when they occurred

### Final Smoke Test

- [ ] Complete journey on a clean machine (no prior config): init → create → list → edit → push → sync → install
- [ ] `skill-forge install --skill <name>` installs only that skill and it appears in Claude Code's skill list
- [ ] Simulate no internet: all commands that need network fail gracefully with a message, not a stack trace

---

**PLAN COMPLETE**

This plan is designed for autonomous execution. Each phase gate must pass before proceeding.
When in doubt on implementation details, apply the principle of least surprise: build the simplest
thing that satisfies the interface contract and passes the verification gate.
