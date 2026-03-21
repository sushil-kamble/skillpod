import { promises as fs } from 'node:fs';
import path from 'node:path';

import { confirm, input, search, select } from '@inquirer/prompts';
import { simpleGit } from 'simple-git';

import { loadConfig } from '#core/global/config/config.js';
import { ensureInitializedRegistryPath } from '#core/global/registry-path/registry-path.js';
import { pushRegistry } from '#core/agent-skill/registry-git/registry-git.js';
import {
  skillCreatorService,
  type SkillCreatorService,
} from '#core/agent-skill/skill-creator/skill-creator.js';
import { copyToClipboard } from '#utils/cli/clipboard.js';
import { editorService, type EditorService } from '#utils/io/editor.js';
import { pathExists } from '#utils/io/filesystem.js';
import { logger, type Logger } from '#utils/logging/logger.js';
import { formatRelativeTime } from '#utils/formatting/ui.js';
import type { SkillPodConfig } from '#types/config.js';

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTION_FALLBACK = '[invalid - check frontmatter]';
const EMPTY_STATE_MESSAGE = 'No skills found. Create one with "skillpod create <name>".';

export interface PromptChoice<T extends string> {
  value: T;
  name: string;
  description?: string;
}

export interface SkillPrompts {
  input(message: string, options?: { defaultValue?: string }): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  search<T extends string>(message: string, choices: PromptChoice<T>[]): Promise<T>;
  select<T extends string>(message: string, choices: PromptChoice<T>[]): Promise<T>;
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
  mode?: AuthoringMode;
}

export interface EditSkillOptions {
  name?: string;
  mode?: AuthoringMode;
}

export interface RemoveSkillOptions {
  name?: string;
  yes?: boolean;
  push?: boolean;
}

export interface SkillCommandDependencies {
  prompts?: SkillPrompts;
  logger?: Logger;
  editor?: EditorService;
  loadConfig?: () => Promise<SkillPodConfig>;
  skillCreator?: SkillCreatorService;
  copyToClipboard?: (text: string) => Promise<boolean>;
  pushToRemote?: (message: string) => Promise<boolean>;
  getLocalChanges?: (localRegistryPath: string, skillName: string) => Promise<boolean>;
}

export type AuthoringMode = 'open-vscode' | 'skip' | 'use-skill-creator';

async function defaultPushToRemote(_message: string): Promise<boolean> {
  try {
    const result = await pushRegistry({ all: true });
    return result.status === 'pushed';
  } catch {
    return false;
  }
}

async function defaultGetLocalChanges(
  localRegistryPath: string,
  skillName: string,
): Promise<boolean> {
  try {
    const git = simpleGit(localRegistryPath);
    const statusOutput = await git.raw(['status', '--porcelain', '--', `skills/${skillName}`]);
    return statusOutput.trim().length > 0;
  } catch {
    return false;
  }
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

  async select<T extends string>(message: string, choices: PromptChoice<T>[]): Promise<T> {
    return select<T>({
      message,
      choices,
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

const VALID_AUTHORING_MODES: readonly AuthoringMode[] = [
  'open-vscode',
  'skip',
  'use-skill-creator',
];

function validateAuthoringMode(mode: string): string | null {
  if (!VALID_AUTHORING_MODES.includes(mode as AuthoringMode)) {
    return `Invalid --mode "${mode}". Valid values: ${VALID_AUTHORING_MODES.join(', ')}.`;
  }

  return null;
}

async function ensureSkillsDirectoryExists(skillsDirectory: string): Promise<void> {
  await fs.mkdir(skillsDirectory, { recursive: true });
}

function parseFrontmatter(content: string): {
  name: string | null;
  description: string | null;
  valid: boolean;
} {
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

function levenshteinDistance(left: string, right: string): number {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );

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

async function readSkillSummary(
  localRegistryPath: string,
  entryName: string,
): Promise<SkillSummary> {
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
    description: frontmatter.valid ? (frontmatter.description ?? '') : DESCRIPTION_FALLBACK,
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
  const skillDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    skillDirectories.map((entryName) => readSkillSummary(localRegistryPath, entryName)),
  );
}

async function resolveSkillName(
  requestedName: string,
  skills: SkillSummary[],
  prompts: SkillPrompts,
  log: Logger,
  interactiveSuggestion: boolean,
): Promise<string> {
  const exactMatch = skills.find(
    (skill) => skill.name === requestedName || path.basename(skill.skillPath) === requestedName,
  );

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
  const selectedName = await prompts.select('Did you mean one of these skills?', [
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

async function promptForAuthoringMode(prompts: SkillPrompts): Promise<AuthoringMode> {
  return prompts.select<AuthoringMode>('How would you like to work on this skill?', [
    {
      value: 'use-skill-creator',
      name: 'Use skill-creator',
      description: 'Print a ready-to-copy prompt for your AI agent',
    },
    {
      value: 'open-vscode',
      name: 'Open in VS Code',
      description: 'Recommended for editing the full skill package',
    },
    {
      value: 'skip',
      name: 'Skip opening anything',
      description: 'Leave the files as-is for now',
    },
  ]);
}

interface SkillCreatorAssistOptions {
  action: 'create' | 'edit';
  skillDirectory: string;
  skillFilePath: string;
  skillName: string;
}

async function runSkillCreatorAssist(
  options: SkillCreatorAssistOptions,
  prompts: SkillPrompts,
  editor: EditorService,
  skillCreator: SkillCreatorService,
  log: Logger,
  clipboardCopy: (text: string) => Promise<boolean>,
): Promise<void> {
  const availability = await skillCreator.detectAvailability();
  const hasSupportedAgent = availability.availableAgents.length > 0;

  if (!hasSupportedAgent) {
    log.warn(`skill-creator setup is incomplete: ${skillCreator.buildDoctorDetail(availability)}`);

    const shouldInstall = await prompts.confirm(
      'Install skill-creator globally for claude-code, opencode, and codex?',
      true,
    );

    if (!shouldInstall) {
      log.info('Falling back to manual editing in VS Code.');
      await openSkillInEditor(options.skillDirectory, editor, log, {
        fallbackFilePath: options.skillFilePath,
        preferDirectory: true,
      });
      return;
    }

    await skillCreator.install();
    log.success('Installed skill-creator globally.');
  } else if (availability.missingAgents.length > 0 || availability.unverifiedAgents.length > 0) {
    log.warn(skillCreator.buildDoctorDetail(availability));
  }

  const basePrompt =
    options.action === 'create'
      ? skillCreator.buildCreatePrompt(options.skillName, options.skillDirectory)
      : skillCreator.buildEditPrompt(options.skillName, options.skillDirectory);

  const prompt = `${basePrompt}\n\n<input>\n`;

  const copied = await clipboardCopy(prompt);

  if (copied) {
    log.success('Prompt copied to clipboard. Paste it into your AI agent.');
  } else {
    log.info('Paste this into your AI agent:\n');
  }

  log.info(prompt);
}

async function handleAuthoringMode(
  options: {
    mode: AuthoringMode;
    action: 'create' | 'edit';
    skillName: string;
    skillDirectory: string;
    skillFilePath: string;
  },
  dependencies: {
    prompts: SkillPrompts;
    editor: EditorService;
    skillCreator: SkillCreatorService;
    log: Logger;
    clipboardCopy: (text: string) => Promise<boolean>;
  },
): Promise<void> {
  if (options.mode === 'skip') {
    dependencies.log.info(
      options.action === 'create'
        ? `Skill created at ${options.skillDirectory}`
        : `Skill available at ${options.skillDirectory}`,
    );
    return;
  }

  if (options.mode === 'use-skill-creator') {
    await runSkillCreatorAssist(
      {
        action: options.action,
        skillDirectory: options.skillDirectory,
        skillFilePath: options.skillFilePath,
        skillName: options.skillName,
      },
      dependencies.prompts,
      dependencies.editor,
      dependencies.skillCreator,
      dependencies.log,
      dependencies.clipboardCopy,
    );
    return;
  }

  await openSkillInEditor(options.skillDirectory, dependencies.editor, dependencies.log, {
    fallbackFilePath: options.skillFilePath,
    preferDirectory: true,
  });
}

export async function createSkill(
  options: CreateSkillOptions = {},
  dependencies: SkillCommandDependencies = {},
): Promise<void> {
  const prompts = dependencies.prompts ?? skillPrompts;
  const log = dependencies.logger ?? logger;
  const editor = dependencies.editor ?? editorService;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const skillCreator = dependencies.skillCreator ?? skillCreatorService;
  const clipboardCopy = dependencies.copyToClipboard ?? copyToClipboard;

  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const requestedName = (options.name ?? (await prompts.input('Skill name'))).trim();
  const validationError = validateSkillName(requestedName);

  if (validationError) {
    throw new Error(validationError);
  }

  if (options.mode !== undefined) {
    const modeError = validateAuthoringMode(options.mode);
    if (modeError) throw new Error(modeError);
  }

  const skillDirectory = getSkillDirectory(localRegistryPath, requestedName);
  const skillFilePath = getSkillFilePath(localRegistryPath, requestedName);

  if (await pathExists(skillDirectory)) {
    const shouldOpen =
      options.mode !== undefined ||
      (await prompts.confirm(
        `Skill "${requestedName}" already exists. Open it for editing?`,
        false,
      ));

    if (!shouldOpen) {
      log.info('Create cancelled.');
      return;
    }

    const mode = options.mode ?? (await promptForAuthoringMode(prompts));
    await handleAuthoringMode(
      {
        action: 'edit',
        mode,
        skillName: requestedName,
        skillDirectory,
        skillFilePath,
      },
      {
        prompts,
        editor,
        skillCreator,
        log,
        clipboardCopy,
      },
    );
    return;
  }

  await fs.mkdir(skillDirectory, { recursive: true });
  await fs.writeFile(skillFilePath, getDefaultSkillTemplate(requestedName), 'utf8');
  log.success(`Created skill "${requestedName}".`);

  const mode = options.mode ?? (await promptForAuthoringMode(prompts));
  await handleAuthoringMode(
    {
      action: 'create',
      mode,
      skillName: requestedName,
      skillDirectory,
      skillFilePath,
    },
    {
      prompts,
      editor,
      skillCreator,
      log,
      clipboardCopy,
    },
  );
}

export interface ListSkillsOptions {
  json?: boolean;
}

export async function listSkills(
  options: ListSkillsOptions = {},
  dependencies: SkillCommandDependencies = {},
): Promise<SkillSummary[]> {
  const prompts = dependencies.prompts ?? skillPrompts;
  const log = dependencies.logger ?? logger;
  const editor = dependencies.editor ?? editorService;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const skillCreator = dependencies.skillCreator ?? skillCreatorService;
  const clipboardCopy = dependencies.copyToClipboard ?? copyToClipboard;
  const checkLocalChanges = dependencies.getLocalChanges ?? defaultGetLocalChanges;
  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const skills = await getSkillSummaries(localRegistryPath);

  if (skills.length === 0) {
    if (options.json) {
      log.info('[]');
    } else {
      log.info(EMPTY_STATE_MESSAGE);
    }
    return [];
  }

  if (options.json) {
    const output = skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.skillPath,
      valid: skill.valid,
    }));
    log.info(JSON.stringify(output, null, 2));
    return skills;
  }

  const now = new Date();
  const choices = await Promise.all(
    skills.map(async (skill) => {
      const dirName = path.basename(skill.skillPath);
      const relative = formatRelativeTime(skill.updatedAt, now);
      const hasChanges = await checkLocalChanges(localRegistryPath, dirName);
      const syncLabel = hasChanges ? 'local changes' : 'synced';
      const desc = truncateText(skill.description, 50);

      return {
        value: dirName,
        name: `${dirName}  ${desc}`,
        description: `${relative} · ${syncLabel}`,
      };
    }),
  );

  const selected = await prompts.select<string>('Select a skill', [
    ...choices,
    {
      value: '__cancel__',
      name: 'Cancel',
      description: 'Go back',
    },
  ]);

  if (selected === '__cancel__') {
    return skills;
  }

  const skillName = selected;
  const skillFilePath = getSkillFilePath(localRegistryPath, skillName);
  const skillDirectory = getSkillDirectory(localRegistryPath, skillName);

  if (!(await pathExists(skillFilePath))) {
    log.warn(`Skill "${skillName}" is missing SKILL.md.`);
    return skills;
  }

  const mode = await promptForAuthoringMode(prompts);
  await handleAuthoringMode(
    {
      action: 'edit',
      mode,
      skillName,
      skillDirectory,
      skillFilePath,
    },
    {
      prompts,
      editor,
      skillCreator,
      log,
      clipboardCopy,
    },
  );

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
  const skillCreator = dependencies.skillCreator ?? skillCreatorService;
  const clipboardCopy = dependencies.copyToClipboard ?? copyToClipboard;

  if (options.mode !== undefined) {
    const modeError = validateAuthoringMode(options.mode);
    if (modeError) throw new Error(modeError);
  }

  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const skills = await getSkillSummaries(localRegistryPath);

  if (skills.length === 0) {
    throw new Error(EMPTY_STATE_MESSAGE);
  }

  let skillName = options.name?.trim();

  if (!skillName) {
    skillName = await prompts.select(
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
    throw new Error(
      `Skill "${skillName}" is missing SKILL.md. Fix it manually at ${path.dirname(skillFilePath)}.`,
    );
  }

  const skillDirectory = getSkillDirectory(localRegistryPath, skillName);
  const mode = options.mode ?? (await promptForAuthoringMode(prompts));
  await handleAuthoringMode(
    {
      action: 'edit',
      mode,
      skillName,
      skillDirectory,
      skillFilePath,
    },
    {
      prompts,
      editor,
      skillCreator,
      log,
      clipboardCopy,
    },
  );
  return skillName;
}

export async function removeSkill(
  options: RemoveSkillOptions = {},
  dependencies: SkillCommandDependencies = {},
): Promise<string | null> {
  const prompts = dependencies.prompts ?? skillPrompts;
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const skills = await getSkillSummaries(localRegistryPath);

  if (skills.length === 0) {
    log.info(EMPTY_STATE_MESSAGE);
    return null;
  }

  let skillName: string;

  if (options.name) {
    skillName = await resolveSkillName(options.name.trim(), skills, prompts, log, true);
  } else {
    const selected = await prompts.select('Select a skill to remove', [
      ...skills.map((skill) => ({
        value: path.basename(skill.skillPath),
        name: path.basename(skill.skillPath),
        description: truncateText(skill.description, 60),
      })),
      {
        value: '__cancel__',
        name: 'Cancel',
        description: 'Stop without removing anything',
      },
    ]);

    if (selected === '__cancel__') {
      log.info('Remove cancelled.');
      return null;
    }

    skillName = selected;
  }

  const skillSummary = await readSkillSummary(localRegistryPath, skillName);
  log.info(`${skillName}: ${truncateText(skillSummary.description, 60)}`);
  log.warn('This cannot be undone locally (but remains in git history).');
  const shouldRemove =
    options.yes === true || (await prompts.confirm(`Remove "${skillName}"?`, false));

  if (!shouldRemove) {
    log.info('Remove cancelled.');
    return null;
  }

  await fs.rm(skillSummary.skillPath, { recursive: true, force: true });
  log.success(`Removed skill "${skillName}" locally.`);

  const shouldPush =
    options.push === true ||
    (options.yes !== true &&
      (await prompts.confirm('Also push this removal to the remote registry?', false)));

  if (shouldPush) {
    const pushFn = dependencies.pushToRemote ?? defaultPushToRemote;
    const pushed = await pushFn(`chore: remove skill "${skillName}"`);

    if (pushed) {
      log.success('Removal pushed to remote.');
    }
  }

  return skillName;
}

export const skillsInternals = {
  DESCRIPTION_FALLBACK,
  EMPTY_STATE_MESSAGE,
  VALID_AUTHORING_MODES,
  getDefaultSkillTemplate,
  getSkillDirectory,
  getSkillFilePath,
  getSkillsDirectory,
  parseFrontmatter,
  rankSkillNames,
  truncateText,
  validateAuthoringMode,
  validateSkillName,
};
