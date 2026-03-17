import { promises as fs } from 'node:fs';
import path from 'node:path';

import { confirm, input, search } from '@inquirer/prompts';

import { loadConfig } from './config.js';
import { ensureInitializedRegistryPath } from './registry-path.js';
import { editorService, type EditorService } from '../utils/editor.js';
import { pathExists } from '../utils/filesystem.js';
import { logger, type Logger } from '../utils/logger.js';
import type { SkillForgeConfig } from '../types/config.js';

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTION_FALLBACK = '[invalid - check frontmatter]';
const EMPTY_STATE_MESSAGE = 'No skills found. Create one with "skill-forge create <name>".';

export interface PromptChoice<T extends string> {
  value: T;
  name: string;
  description?: string;
}

export interface SkillPrompts {
  input(message: string, options?: { defaultValue?: string }): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  search<T extends string>(message: string, choices: PromptChoice<T>[]): Promise<T>;
}

export interface SkillSummary {
  name: string;
  description: string;
  skillPath: string;
  skillFilePath: string;
  updatedAt: Date;
  valid: boolean;
}

export interface CreateSkillOptions {
  name?: string;
}

export interface EditSkillOptions {
  name?: string;
}

export interface RemoveSkillOptions {
  name: string;
}

export interface SkillCommandDependencies {
  prompts?: SkillPrompts;
  logger?: Logger;
  editor?: EditorService;
  loadConfig?: () => Promise<SkillForgeConfig>;
}

const skillPrompts: SkillPrompts = {
  async input(message: string, options?: { defaultValue?: string }): Promise<string> {
    return input(
      options?.defaultValue
        ? {
            message,
            default: options.defaultValue,
          }
        : {
            message,
          },
    );
  },

  async confirm(message: string, defaultValue = false): Promise<boolean> {
    return confirm({
      message,
      default: defaultValue,
    });
  },

  async search<T extends string>(message: string, choices: PromptChoice<T>[]): Promise<T> {
    return search<T>({
      message,
      source(term) {
        const normalizedTerm = term?.trim().toLowerCase() ?? '';

        return choices.filter((choice) => {
          if (!normalizedTerm) {
            return true;
          }

          const haystack = `${choice.name} ${choice.description ?? ''}`.toLowerCase();
          return haystack.includes(normalizedTerm);
        });
      },
    });
  },
};

function getDefaultSkillTemplate(name: string): string {
  const title = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return `---
name: ${name}
description:
  [Describe what this skill does and when the agent should activate it]
---

# ${title}

## When to Use

[Describe the scenarios where this skill applies]

## Instructions

[Step-by-step or behavioral instructions for the agent]

## Edge Cases

[What the agent should do when things don't go as expected]
`;
}

function getSkillsDirectory(localRegistryPath: string): string {
  return path.join(localRegistryPath, 'skills');
}

function getSkillDirectory(localRegistryPath: string, name: string): string {
  return path.join(getSkillsDirectory(localRegistryPath), name);
}

function getSkillFilePath(localRegistryPath: string, name: string): string {
  return path.join(getSkillDirectory(localRegistryPath, name), 'SKILL.md');
}

function validateSkillName(name: string): string | null {
  if (!SKILL_NAME_PATTERN.test(name)) {
    return 'Skill name must be lowercase, use hyphens only, and contain no spaces or special characters.';
  }

  return null;
}

async function ensureSkillsDirectoryExists(skillsDirectory: string): Promise<void> {
  await fs.mkdir(skillsDirectory, { recursive: true });
}

function parseFrontmatter(content: string): { name: string | null; description: string | null; valid: boolean } {
  if (!content.startsWith('---\n')) {
    return { name: null, description: null, valid: false };
  }

  const endIndex = content.indexOf('\n---\n', 4);

  if (endIndex === -1) {
    return { name: null, description: null, valid: false };
  }

  const frontmatter = content.slice(4, endIndex);
  const lines = frontmatter.split('\n');
  let name: string | null = null;
  let description: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === undefined) {
      continue;
    }

    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('name:')) {
      const value = trimmedLine.slice('name:'.length).trim();
      name = value.length > 0 ? value : null;
      continue;
    }

    if (trimmedLine.startsWith('description:')) {
      const inlineValue = trimmedLine.slice('description:'.length).trim();

      if (inlineValue.length > 0) {
        description = inlineValue;
        continue;
      }

      const blockLines: string[] = [];

      for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
        const blockLine = lines[blockIndex];

        if (blockLine === undefined) {
          break;
        }

        if (/^\s+/.test(blockLine)) {
          blockLines.push(blockLine.trim());
          index = blockIndex;
          continue;
        }

        break;
      }

      description = blockLines.join(' ').trim() || null;
    }
  }

  return {
    name,
    description,
    valid: name !== null,
  };
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function padCell(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

function formatTable(rows: SkillSummary[]): string {
  const headers = ['Name', 'Description', 'Updated'];
  const tableRows = rows.map((row) => [
    row.valid ? row.name : `${row.name} [invalid]`,
    truncateText(row.description, 60),
    formatDate(row.updatedAt),
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...tableRows.map((row) => row[index]?.length ?? 0)),
  );

  const separator = widths.map((width) => '-'.repeat(width)).join('  ');
  const headerLine = headers.map((header, index) => padCell(header, widths[index] ?? header.length)).join('  ');
  const bodyLines = tableRows.map((row) =>
    row.map((cell, index) => padCell(cell ?? '', widths[index] ?? 0)).join('  '),
  );

  return [headerLine, separator, ...bodyLines].join('\n');
}

function levenshteinDistance(left: string, right: string): number {
  const matrix = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));

  for (let index = 0; index <= left.length; index += 1) {
    matrix[index]![0] = index;
  }

  for (let index = 0; index <= right.length; index += 1) {
    matrix[0]![index] = index;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost,
      );
    }
  }

  return matrix[left.length]![right.length]!;
}

function rankSkillNames(names: string[], target: string): string[] {
  const normalizedTarget = target.toLowerCase();

  return [...names]
    .map((name) => {
      const normalizedName = name.toLowerCase();
      const containsTarget = normalizedName.includes(normalizedTarget);
      const containsName = normalizedTarget.includes(normalizedName);

      return {
        name,
        score: levenshteinDistance(normalizedName, normalizedTarget),
        directMatch: containsTarget || containsName,
      };
    })
    .sort((left, right) => {
      if (left.directMatch !== right.directMatch) {
        return left.directMatch ? -1 : 1;
      }

      return left.score - right.score;
    })
    .slice(0, 3)
    .map((entry) => entry.name);
}

async function readSkillSummary(localRegistryPath: string, entryName: string): Promise<SkillSummary> {
  const skillPath = getSkillDirectory(localRegistryPath, entryName);
  const skillFilePath = path.join(skillPath, 'SKILL.md');

  if (!(await pathExists(skillFilePath))) {
    const directoryStats = await fs.stat(skillPath);

    return {
      name: entryName,
      description: DESCRIPTION_FALLBACK,
      skillPath,
      skillFilePath,
      updatedAt: directoryStats.mtime,
      valid: false,
    };
  }

  const [content, fileStats] = await Promise.all([
    fs.readFile(skillFilePath, 'utf8'),
    fs.stat(skillFilePath),
  ]);
  const frontmatter = parseFrontmatter(content);

  return {
    name: frontmatter.name ?? entryName,
    description: frontmatter.valid ? frontmatter.description ?? '' : DESCRIPTION_FALLBACK,
    skillPath,
    skillFilePath,
    updatedAt: fileStats.mtime,
    valid: frontmatter.valid,
  };
}

async function getSkillSummaries(localRegistryPath: string): Promise<SkillSummary[]> {
  const skillsDirectory = getSkillsDirectory(localRegistryPath);
  await ensureSkillsDirectoryExists(skillsDirectory);

  const entries = await fs.readdir(skillsDirectory, { withFileTypes: true });
  const skillDirectories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  return Promise.all(skillDirectories.map((entryName) => readSkillSummary(localRegistryPath, entryName)));
}

async function resolveSkillName(
  requestedName: string,
  skills: SkillSummary[],
  prompts: SkillPrompts,
  log: Logger,
  interactiveSuggestion: boolean,
): Promise<string> {
  const exactMatch = skills.find((skill) => skill.name === requestedName || path.basename(skill.skillPath) === requestedName);

  if (exactMatch) {
    return path.basename(exactMatch.skillPath);
  }

  const skillNames = skills.map((skill) => path.basename(skill.skillPath));
  const suggestions = rankSkillNames(skillNames, requestedName).filter(
    (name) => name.toLowerCase() !== requestedName.toLowerCase(),
  );

  if (!interactiveSuggestion || suggestions.length === 0) {
    const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
    throw new Error(`Skill "${requestedName}" not found.${suffix}`);
  }

  log.warn(`Skill "${requestedName}" not found.`);
  const selectedName = await prompts.search('Did you mean one of these skills?', [
    ...suggestions.map((name) => ({
      value: name,
      name,
      description: 'Existing skill',
    })),
    {
      value: '__cancel__',
      name: 'Cancel',
      description: 'Stop without changing anything',
    },
  ]);

  if (selectedName === '__cancel__') {
    throw new Error('Operation cancelled.');
  }

  return selectedName;
}

async function openSkillInEditor(
  targetPath: string,
  editor: EditorService,
  log: Logger,
  options?: {
    fallbackFilePath?: string;
    preferDirectory?: boolean;
  },
): Promise<void> {
  const result = await editor.open(targetPath, options);

  if (!result.opened) {
    log.warn(`No editor found. Open this path manually: ${targetPath}`);
    return;
  }

  log.info(`Opened: ${result.targetPath}`);
}

export async function createSkill(
  options: CreateSkillOptions = {},
  dependencies: SkillCommandDependencies = {},
): Promise<void> {
  const prompts = dependencies.prompts ?? skillPrompts;
  const log = dependencies.logger ?? logger;
  const editor = dependencies.editor ?? editorService;
  const readConfig = dependencies.loadConfig ?? loadConfig;

  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const requestedName = (options.name ?? (await prompts.input('Skill name'))).trim();
  const validationError = validateSkillName(requestedName);

  if (validationError) {
    throw new Error(validationError);
  }

  const skillDirectory = getSkillDirectory(localRegistryPath, requestedName);
  const skillFilePath = getSkillFilePath(localRegistryPath, requestedName);

  if (await pathExists(skillDirectory)) {
    const shouldOpen = await prompts.confirm(
      `Skill "${requestedName}" already exists. Open it for editing?`,
      false,
    );

    if (!shouldOpen) {
      log.info('Create cancelled.');
      return;
    }

    await openSkillInEditor(skillDirectory, editor, log, {
      fallbackFilePath: skillFilePath,
      preferDirectory: true,
    });
    return;
  }

  await fs.mkdir(skillDirectory, { recursive: true });
  await fs.writeFile(skillFilePath, getDefaultSkillTemplate(requestedName), 'utf8');
  await openSkillInEditor(skillFilePath, editor, log);
}

export async function listSkills(dependencies: SkillCommandDependencies = {}): Promise<SkillSummary[]> {
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const skills = await getSkillSummaries(localRegistryPath);

  if (skills.length === 0) {
    log.info(EMPTY_STATE_MESSAGE);
    return [];
  }

  log.info(formatTable(skills));
  return skills;
}

export async function editSkill(
  options: EditSkillOptions = {},
  dependencies: SkillCommandDependencies = {},
): Promise<string> {
  const prompts = dependencies.prompts ?? skillPrompts;
  const log = dependencies.logger ?? logger;
  const editor = dependencies.editor ?? editorService;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const skills = await getSkillSummaries(localRegistryPath);

  if (skills.length === 0) {
    throw new Error(EMPTY_STATE_MESSAGE);
  }

  let skillName = options.name?.trim();

  if (!skillName) {
    skillName = await prompts.search(
      'Select a skill to edit',
      skills.map((skill) => ({
        value: path.basename(skill.skillPath),
        name: path.basename(skill.skillPath),
        description: truncateText(skill.description, 60),
      })),
    );
  } else {
    skillName = await resolveSkillName(skillName, skills, prompts, log, false);
  }

  const skillFilePath = getSkillFilePath(localRegistryPath, skillName);

  if (!(await pathExists(skillFilePath))) {
    throw new Error(`Skill "${skillName}" is missing SKILL.md. Fix it manually at ${path.dirname(skillFilePath)}.`);
  }

  const skillDirectory = getSkillDirectory(localRegistryPath, skillName);
  await openSkillInEditor(skillDirectory, editor, log, {
    fallbackFilePath: skillFilePath,
    preferDirectory: true,
  });
  return skillName;
}

export async function removeSkill(
  options: RemoveSkillOptions,
  dependencies: SkillCommandDependencies = {},
): Promise<string | null> {
  const prompts = dependencies.prompts ?? skillPrompts;
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const skills = await getSkillSummaries(localRegistryPath);
  const skillName = await resolveSkillName(options.name.trim(), skills, prompts, log, true);
  const skillSummary = await readSkillSummary(localRegistryPath, skillName);
  const description = truncateText(skillSummary.description, 80);
  const shouldRemove = await prompts.confirm(
    `Remove skill "${skillName}"? ${description} This cannot be undone locally (but remains in git history).`,
    false,
  );

  if (!shouldRemove) {
    log.info('Remove cancelled.');
    return null;
  }

  await fs.rm(skillSummary.skillPath, { recursive: true, force: true });
  log.success(`Removed skill "${skillName}".`);
  return skillName;
}

export const skillsInternals = {
  DESCRIPTION_FALLBACK,
  EMPTY_STATE_MESSAGE,
  formatTable,
  getDefaultSkillTemplate,
  getSkillDirectory,
  getSkillFilePath,
  getSkillsDirectory,
  parseFrontmatter,
  rankSkillNames,
  truncateText,
  validateSkillName,
};
