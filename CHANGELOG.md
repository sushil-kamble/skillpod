# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
