---
name: skillpod-cli
description: >
  Complete reference for the `skillpod` CLI — a tool for authoring, managing, and syncing personal agent skill registries backed by GitHub. Use this skill whenever the user mentions skillpod, skill registries, installing agent skills, pushing/pulling skills, the `skillpod` command, creating or editing SKILL.md files via skillpod, or managing their local skill collection. Also trigger for questions about skillpod init, skillpod install, skillpod send, skillpod push/pull, or any skillpod subcommand — even if the user doesn't say "skillpod" explicitly but is clearly working with their skill registry.
---

# skillpod CLI

`skillpod` lets you author, version, and share agent skills backed by a GitHub repository. Skills live in your registry; the CLI handles the Git plumbing so you can focus on the skill content.

## Quick-reference: command summary

| Goal             | Command                   |
| ---------------- | ------------------------- |
| First-time setup | `skillpod init`           |
| Create a skill   | `skillpod create <name>`  |
| Edit a skill     | `skillpod edit <name>`    |
| List skills      | `skillpod list`           |
| Remove a skill   | `skillpod remove <name>`  |
| Push changes     | `skillpod push`           |
| Pull changes     | `skillpod pull`           |
| Send a local dir | `skillpod send <path>`    |
| Install a skill  | `skillpod install <name>` |
| Health check     | `skillpod doctor`         |
| Wipe everything  | `skillpod unload`         |

---

## Setup

Initialize skillpod before using any other command. The wizard will ask for a GitHub token and registry repo URL.

```bash
skillpod init                                          # interactive wizard
skillpod init --token <token>                          # provide token directly
skillpod init --repo <url>                             # provide repo URL directly
skillpod init -y                                       # auto-confirm reinitialize
skillpod init --token <token> --repo <url> -y          # fully non-interactive
```

Config is stored at `~/.skillpod/config.json` (permissions `0o600`). Run `skillpod doctor` to verify the setup is healthy.

---

## Skill Authoring

### Create

```bash
skillpod create <name>                    # create skill, prompts for editor mode
skillpod create <name> --mode use-skill-creator  # print AI prompt to fill in the skill
skillpod create <name> --mode open-vscode # create, open in VS Code
```

> If you are an agent use `use-skill-creator` mode
> **Tip — `use-skill-creator` mode**: This mode prints a prompt you can paste into an AI assistant (like Claude Code with the `skill-creator` skill) to have it author the SKILL.md content for you. Replace `<input>` in the output with a description of what you want the skill to do.

### Edit

```bash
skillpod edit <name>                       # edit skill, prompts for mode
skillpod edit <name> --mode skip
skillpod edit <name> --mode open-vscode
skillpod edit <name> --mode use-skill-creator
```

Same `--mode` options as `create`. Use `use-skill-creator` mode to regenerate or improve the skill content with AI assistance — replace `<input>` in the output with guidance on what to change.

### List

```bash
skillpod list           # interactive fuzzy-select list
skillpod list --json    # machine-readable JSON output (non-interactive)
```

### Remove

```bash
skillpod remove <name>          # prompts for confirmation
skillpod remove <name> -y       # skip confirmation
skillpod remove <name> -y --push  # remove and immediately push to remote
```

---

## Registry Sync

### Push

Commits and pushes skill changes to the remote GitHub registry.

```bash
skillpod push                     # interactive skill selection
skillpod push --skill <name>      # push a specific skill
skillpod push --all               # push all changed skills
```

### Pull

Pulls skill updates from the remote registry into your local copy.

```bash
skillpod pull                     # interactive skill selection
skillpod pull --skill <name>      # pull a specific skill
skillpod pull --all               # pull all skills
```

### Send

Sends a local skill directory (e.g., one you received or developed outside the registry) to your remote registry. It validates the skill, pulls the latest remote state, copies the skill in, and pushes.

```bash
skillpod send <path>          # send local skill dir to registry
skillpod send <path> --force  # overwrite if the skill name already exists
```

Use `send` when you have a skill directory on disk (perhaps from another machine or a `.skill` package you unpacked) and want to add it to your registry.

---

## Install

Installs a skill from your registry into your agent(s). Under the hood this delegates to `npx skills add`.

```bash
skillpod install                          # interactive selection
skillpod install <name>                   # install specific skill

# Flags forwarded to skills.sh (npx skills add):
skillpod install <name> -g                # install at user (global) scope
skillpod install <name> -a claude-code    # target Claude Code specifically
skillpod install <name> -a opencode       # target OpenCode
skillpod install <name> -a claude-code -a opencode  # multiple agents
skillpod install <name> -y                # skip confirmation prompts
skillpod install <name> --copy            # copy files instead of symlinking

# Combine flags freely:
skillpod install <name> -g -a claude-code -y
```

---

## Maintenance

```bash
skillpod doctor       # check config health, token validity, repo reachability
skillpod unload       # remove all skillpod data (prompts for confirmation)
skillpod unload -y    # remove all skillpod data without prompting
```

`doctor` is the first thing to run when something isn't working — it surfaces misconfigurations clearly.

---

## Common Workflows

### First-time setup from scratch

```bash
skillpod init --token ghp_xxx --repo https://github.com/you/skills -y
skillpod doctor
```

### Create and publish a new skill

```bash
skillpod create my-skill --mode open-vscode   # write SKILL.md in editor
skillpod push --skill my-skill
```

### Use AI to author a skill

```bash
skillpod create my-skill --mode use-skill-creator
# paste the printed prompt into Claude Code and replace <input>
# then open the created SKILL.md and paste the AI-generated content
skillpod push --skill my-skill
```

### Install a skill into Claude Code globally

```bash
skillpod pull --all                            # make sure registry is up to date
skillpod install my-skill -g -a claude-code -y
```

### Import a skill from another source

```bash
skillpod send ~/Downloads/my-new-skill/        # send dir to your registry
skillpod install my-new-skill -g -a claude-code -y
```

---

## Skill Structure

Each skill is a directory in your registry:

```
<skill-name>/
├── SKILL.md          (required — YAML frontmatter + markdown instructions)
└── references/       (optional — extra docs loaded on demand)
└── scripts/          (optional — helper scripts bundled with the skill)
└── assets/           (optional — templates, icons, etc.)
```

The `SKILL.md` frontmatter requires at minimum:

```yaml
---
name: skill-name
description: What this skill does and when to trigger it.
---
```

---

## Troubleshooting

| Symptom                    | Fix                                                                           |
| -------------------------- | ----------------------------------------------------------------------------- |
| Auth errors on push/pull   | Run `skillpod doctor`; re-run `skillpod init --token <new-token>`             |
| Skill not found after pull | Check `skillpod list --json` to confirm it pulled; verify skill name spelling |
| Install fails              | Ensure `npx` / Node is on PATH; try `--copy` to avoid symlink issues          |
| Config looks wrong         | Inspect `~/.skillpod/config.json`; re-run `skillpod init` to reset            |
