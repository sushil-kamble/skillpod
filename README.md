# skillpod

`skillpod` is a CLI for building and managing your personal agent skills registry.

It gives you a clean authoring workflow for creating reusable agent skills, storing them in GitHub, pushing and pulling them with git, and installing them into your coding agents through the `skills` ecosystem.

This project is designed for developers who want their skills to feel like real assets:

- versioned in git
- easy to edit locally
- portable across machines
- simple to publish and install

## Why skillpod

Authoring agent skills by hand gets messy fast. Files drift, repos become ad hoc, and installing into different agents turns into a pile of one-off commands.

`skillpod` turns that into a repeatable workflow:

- `init` sets up a GitHub-backed registry
- `create`, `edit`, `list`, and `remove` manage skills locally
- `create` and `edit` are VS Code-first, so authoring does not trap you in an inline terminal editor
- optional `skill-creator` assist gives you a ready-to-copy prompt for Claude Code, OpenCode, or Codex (auto-copied to clipboard)
- `push` shows your local skills and lets you push individual skills or all changes
- `pull` shows remote skills and lets you pull them locally
- `send` publishes a skill directory from anywhere on disk directly into the registry and auto-pushes it
- `install` lets you pick a remote skill and install it into your agents via `npx skills add ...`
- `doctor` gives you a quick health check when something is off
- `unload` cleanly removes all local config, credentials, and the registry clone when you're done

## Features

- GitHub-backed personal skills registry
- Local-first workflow with explicit push and pull
- Multi-file skill packages, not just a single `SKILL.md`
- Interactive navigable lists throughout — browse skills, select to act
- VS Code-first authoring flow for `create` and `edit`
- Optional `skill-creator` assisted authoring with clipboard copy and `<input>` tag for user context
- Compatible with the `skills` / `skills.sh` ecosystem
- Spinners, icons, and relative timestamps for a polished terminal experience
- GitHub token is saved locally and reused across sessions — no re-entering on every run
- GitHub authentication is optional during init for a lighter setup
- Auto-create gracefully handles existing repositories instead of failing
- Clean unload to remove all local state without touching remote repos
- Production-ready guards for init state, Node version, git state, and token validation

## Install

Node.js `20+` is required.

For the best authoring experience, make sure the VS Code shell command is available as `code`.

Install globally with your preferred package manager:

```bash
npm install -g skillpod
```

```bash
pnpm add -g skillpod
```

## Quick Start

Initialize your registry:

```bash
skillpod init
```

Create a skill:

```bash
skillpod create fastapi-structure
```

`skillpod` will then let you choose how to work:

- open the skill package in VS Code
- use the external `skill-creator` skill and paste a generated prompt into your AI agent
- skip opening anything for now

Browse your local skills:

```bash
skillpod list
```

This shows an interactive list with descriptions, relative modification times, and sync status. Selecting a skill opens the same authoring mode menu as `edit`.

Push your changes to GitHub:

```bash
skillpod push
```

This shows all local skills with their push status. Select a specific skill to push or choose "Push all changes".

Pull skills from the remote registry:

```bash
skillpod pull
```

This shows all remote skills with their local status. Select a skill to pull or choose "Pull all".

Install your skills into your agent environment:

```bash
skillpod install
```

This shows available remote skills and lets you pick which one to install. You can also pass flags directly:

```bash
skillpod install --skill api-review -g -a claude-code
```

If something looks broken:

```bash
skillpod doctor
```

To remove skillpod from your machine (config, credentials, local registry):

```bash
skillpod unload
```

This does not touch your remote GitHub repository.

## Typical Workflow

```bash
skillpod init
skillpod create api-review
skillpod edit api-review
skillpod push
skillpod install
```

If you have an existing skill directory outside the registry, use `send` to import it in one step:

```bash
skillpod send ./path/to/my-skill
```

With the assist flow enabled, a common authoring loop looks like this:

```bash
skillpod create fastapi-best-practices
# choose "Use skill-creator"
# prompt is auto-copied to clipboard — paste into Claude Code, OpenCode, or Codex
skillpod push
```

## Commands

```bash
skillpod init
skillpod doctor
skillpod create [name]
skillpod list
skillpod edit [name]
skillpod remove [name]
skillpod send <path> [--force]
skillpod push [-m "message"]
skillpod pull
skillpod install [--list] [--skill <name>]... [-g] [-a <agent>] [-y] [--copy]
skillpod unload [--yes]
```

## Send

`skillpod send <path>` imports a skill directory from anywhere on disk into your registry and pushes it to GitHub in one step.

```bash
skillpod send ./my-skill
skillpod send ./my-skill --force   # overwrite if it already exists in the registry
```

The directory must contain a `SKILL.md` with valid frontmatter:

```markdown
---
name: my-skill
description: What this skill does
---
```

`send` validates the frontmatter, copies the full directory into your local registry, then runs a `push` for that skill automatically. It is the fastest path when you already have a skill built outside of `skillpod`.

## Authoring Modes

When you run `create`, `edit`, or select a skill from `list`, `skillpod` offers three paths:

- `Open in VS Code`: opens the full skill directory so you can work on `SKILL.md`, reference markdown files, and scripts together
- `Use skill-creator`: checks whether the external `skill-creator` skill is installed globally, prints a ready-to-copy prompt (auto-copied to clipboard), and appends an `<input>` tag for optional user context
- `Skip opening anything`: creates or resolves the skill package and exits cleanly

If `skill-creator` is missing, `skillpod` can optionally install it for:

- `claude-code`
- `opencode`
- `codex`

using the canonical command:

```bash
npx skills add https://github.com/anthropics/skills --skill skill-creator -g -a claude-code -a opencode -a codex
```

## Skill Structure

`skillpod` works with skill directories, not just single files. A skill can include:

```text
skills/
  fastapi-structure/
    SKILL.md
    REFERENCE.md
    PATTERNS.md
    scripts/
      validate.py
```

That makes it practical to keep instructions, references, examples, and helper scripts together in one package.

## What `init` Sets Up

`skillpod init` will:

- ask for a GitHub Personal Access Token (optional — press Enter to skip for a lighter setup)
- reuse a saved token from a previous session if one exists
- create or connect to a GitHub repo (auto-create recovers gracefully if the repo already exists)
- clone that repo locally
- ensure a `skills/` directory exists
- store your local config in `~/.skillpod/config.json`

## Unload

`skillpod unload` cleanly removes all local skillpod state:

- `~/.skillpod/` config directory (including your stored GitHub token)
- the local registry clone

Your remote GitHub repository is **not** affected. You'll be asked to confirm before anything is deleted. Run `skillpod init` to set up again.

## Install Bridge

The `install` command does not reimplement another installer. It delegates to:

```bash
npx skills add <githubUsername>/skills
```

When no `--skill` flag is provided, `install` fetches the list of remote skills from your GitHub registry and lets you pick which one to install interactively.

## Doctor

`skillpod doctor` checks the required parts of your setup:

- config file
- local git registry
- GitHub token
- remote repository reachability
- `npx`

It also includes a recommended authoring check for `skill-creator`. That check does not fail `doctor`, but it tells you whether the optional assisted workflow is ready for:

- `claude-code`
- `opencode`
- `codex`

## Development

```bash
pnpm install
pnpm run build
pnpm test
```

## Status

`skillpod` is currently in `0.x` and intended for early adopters and pilot usage. The workflow is real, but the product is still evolving.

## License

ISC
