# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-03-22

### Fixed

- README now documents the `send` command, `--force` flag, and `unload --yes` flag.

## [0.3.0] - 2026-03-22

### Added

- `send` command to publish a local skill directory directly into the registry — validates `SKILL.md` frontmatter, copies all files, and auto-pushes to remote.
- Runtime guards: Node.js version check (≥ 20) and initialization gate that blocks commands requiring config before `init` has been run.
- `--yes` flag on `unload` to skip the confirmation prompt in non-interactive environments.

### Changed

- Internal source reorganized into `src/core/agent-skill/` and `src/core/global/` sub-trees for cleaner separation of concerns.
- `unload` now correctly resolves the local registry path before deletion.

## [0.2.3] - 2026-03-19

### Added

- Private GitHub registry support: when the skills repository is private, the stored GitHub token is now automatically forwarded to the `npx skills` subprocess via `GITHUB_TOKEN`, `GH_TOKEN`, and a git URL rewrite (`GIT_CONFIG_*`) so that cloning works without any extra credential configuration.

### Fixed

- Repository URL prompt cursor now appears at the correct position on all terminal widths.
- Skill selection prompts (`edit`, `list`, `remove`) now use the `select` widget (arrow-key navigation) instead of the `search` widget, removing the confusing text-input cursor on fixed lists.
- Authoring mode prompt now presents "Use skill-creator" as the first option.

## [0.2.2] - 2026-03-18

### Fixed

- `doctor` command now treats a missing GitHub token as a recommendation instead of a failure, since authentication is optional.
- `install` command now works without a GitHub token by deriving the registry owner from the configured repository URL.
- Unauthenticated GitHub API access now works correctly for public repositories.

## [0.2.1] - 2026-03-18

### Added

- `unload` command to completely remove skillpod configuration, local registry, and stored credentials from the machine. Remote repositories on GitHub are not affected.

## [0.2.0] - 2026-03-18

### Changed

- Init flow now reuses saved GitHub token from config instead of re-prompting.
- GitHub authentication is now optional during init — press Enter to skip.
- Auto-create gracefully recovers when a "skills" repository already exists, offering to use it instead of failing.

### Added

- `resolveRepositoryFromUrl` method on GitHubService for token-free URL parsing.
- `warn()` method on Spinner interface.

## [0.1.3] - 2026-03-18

### Changed

- Raised minimum Node.js version from 18 to 20 (dependencies require the `v` regex flag).
- CI matrix updated to Node 20 and 22.

## [0.1.2] - 2026-03-18

### Added

- LICENSE file (ISC).
- CLAUDE.md and AGENTS.md for AI agent context.
- GitHub Actions CI workflow (Node 20, 22).
- Git tags for releases.

### Changed

- Set package author to Sushil Kamble.

## [0.1.1] - 2026-03-18

### Changed

- Disabled source map and declaration generation to reduce package size by 52% (215 KB to 102 KB).
- Excluded test utilities from the published package.

## [0.1.0] - 2026-03-18

### Added

- Initial release with `init`, `create`, `edit`, `list`, `remove`, `install`, `push`, `pull`, and `doctor` commands.
- Interactive skill selection for install and remove commands.
- Git-based registry management with push/pull sync.
- GitHub integration for remote skill registries.
- Skill creator integration with agent detection.
- UI utilities with spinners, colored output, and formatted tables.
