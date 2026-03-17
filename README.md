# skill-forge

`skill-forge` is a CLI for building and managing your personal agent skills registry.

It gives you a clean authoring workflow for creating reusable agent skills, storing them in GitHub, syncing them locally with git, and installing them into your coding agents through the `skills` ecosystem.

This project is designed for developers who want their skills to feel like real assets:

- versioned in git
- easy to edit locally
- portable across machines
- simple to publish and install

## Why skill-forge

Authoring agent skills by hand gets messy fast. Files drift, repos become ad hoc, and installing into different agents turns into a pile of one-off commands.

`skill-forge` turns that into a repeatable workflow:

- `init` sets up a GitHub-backed registry
- `create`, `edit`, `list`, and `remove` manage skills locally
- `push` and `sync` keep your registry in sync with GitHub
- `install` hands off to `npx skills add ...` so your skills are available in your agents
- `doctor` gives you a quick health check when something is off

## Features

- GitHub-backed personal skills registry
- Local-first workflow with explicit push and sync
- Multi-file skill packages, not just a single `SKILL.md`
- Compatible with the `skills` / `skills.sh` ecosystem
- Interactive CLI with safe prompts and clear failure modes
- Production-ready guards for init state, Node version, git state, and token validation

## Install

Node.js `18+` is required.

Install globally with your preferred package manager:

```bash
npm install -g skill-forge
```

```bash
pnpm add -g skill-forge
```

## Quick Start

Initialize your registry:

```bash
skill-forge init
```

Create a skill:

```bash
skill-forge create fastapi-structure
```

Review your local registry:

```bash
skill-forge list
```

Push your changes to GitHub:

```bash
skill-forge push
```

Install your skills into your agent environment:

```bash
skill-forge install
```

If something looks broken:

```bash
skill-forge doctor
```

## Typical Workflow

```bash
skill-forge init
skill-forge create api-review
skill-forge edit api-review
skill-forge push -m "add api-review skill"
skill-forge install --skill api-review
```

## Commands

```bash
skill-forge init
skill-forge doctor
skill-forge create [name]
skill-forge list
skill-forge edit [name]
skill-forge remove <name>
skill-forge push [-m "message"]
skill-forge sync
skill-forge install [--list] [--skill <name>]... [-g] [-a <agent>] [-y] [--copy]
```

## Skill Structure

`skill-forge` works with skill directories, not just single files. A skill can include:

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

`skill-forge init` will:

- validate your GitHub Personal Access Token
- create or connect to a GitHub repo
- clone that repo locally
- ensure a `skills/` directory exists
- store your local config in `~/.skill-forge/config.json`

## Install Bridge

The `install` command does not reimplement another installer. It delegates to:

```bash
npx skills add <githubUsername>/skills
```

That keeps `skill-forge` focused on authoring and registry management while still fitting into the broader skills tooling ecosystem.

## Development

```bash
pnpm install
pnpm run build
pnpm test
```

## Status

`skill-forge` is currently in `0.x` and intended for early adopters and pilot usage. The workflow is real, but the product is still evolving.

## License

ISC
