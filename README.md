# skillpod

`skillpod` is a CLI for managing your personal agent skills registry on GitHub.

It helps you:

- create and edit skills locally
- keep them versioned in a GitHub repo
- push and pull skill changes between local and remote
- install skills into your coding agents through the `skills` ecosystem

## Install

Node.js `20+` is required.

```bash
npm install -g skillpod
```

or

```bash
pnpm add -g skillpod
```

For the best editing experience, have the VS Code shell command available as `code`.

## What You Get

- GitHub-backed personal skills registry
- local authoring with explicit `push` and `pull`
- interactive skill selection in the CLI
- multi-file skill packages, not just `SKILL.md`
- optional `skill-creator` assist flow for AI-authored skills
- direct install flow into Claude Code, OpenCode, Codex, and other `skills` targets

## Quick Start

### 1. Initialize your registry

```bash
skillpod init
```

This sets up your local config, connects to a GitHub repo, and ensures a `skills/` directory exists.

### 2. Create your first skill

```bash
skillpod create fastapi-best-practices
```

You will be prompted to either:

- use `skill-creator`
- open the skill in VS Code

### 3. Edit an existing skill

```bash
skillpod edit fastapi-best-practices
```

Or browse and pick from your local registry:

```bash
skillpod list
```

### 4. Sync your local changes to GitHub

```bash
skillpod push
```

Push one specific skill:

```bash
skillpod push --skill fastapi-best-practices
```

### 5. Pull changes from GitHub

```bash
skillpod pull
```

Pull one specific skill:

```bash
skillpod pull --skill fastapi-best-practices
```

### 6. Install a skill into your agent

```bash
skillpod install fastapi-best-practices -g -a claude-code
```

Examples:

```bash
skillpod install fastapi-best-practices -g -a codex
skillpod install fastapi-best-practices -a claude-code -a opencode -y
```

## Typical Workflow

This is the normal day-to-day flow:

```bash
skillpod init
skillpod create api-review
skillpod edit api-review
skillpod push --skill api-review
skillpod install api-review -g -a claude-code
```

If you switch machines or someone else changed the registry:

```bash
skillpod pull
```

Then continue editing and push again:

```bash
skillpod edit api-review
skillpod push --skill api-review
```

## Common Commands

```bash
skillpod init
skillpod doctor

skillpod create <name>
skillpod edit <name>
skillpod list
skillpod remove <name>

skillpod push
skillpod push --skill <name>

skillpod pull
skillpod pull --skill <name>

skillpod install <name> -g -a claude-code

skillpod send ./path/to/skill
skillpod send ./path/to/skill --force

skillpod unload
```

## Import an Existing Skill

If you already have a skill folder somewhere on disk:

```bash
skillpod send ./my-skill
```

This validates the skill, copies it into your registry, and pushes it to GitHub.

## Skill Structure

`skillpod` works with full skill folders:

```text
skills/
  my-skill/
    SKILL.md
    references/
    scripts/
    assets/
```

Minimum `SKILL.md` frontmatter:

```md
---
name: my-skill
description: What this skill does
---
```

## Troubleshooting

Check setup health:

```bash
skillpod doctor
```

Remove local `skillpod` state from your machine:

```bash
skillpod unload
```

This does not delete your remote GitHub repository.

## Full CLI Reference

If you want the longer command reference, see [USE_CLI.md](./USE_CLI.md).

## License

ISC
