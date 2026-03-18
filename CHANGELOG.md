# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
