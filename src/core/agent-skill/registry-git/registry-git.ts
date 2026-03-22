import { search } from '@inquirer/prompts';
import chalk from 'chalk';
import { simpleGit, type SimpleGit } from 'simple-git';

import { loadConfig } from '#core/global/config/config.js';
import { githubService, type GitHubService } from '#core/global/github/github.js';
import { ensureInitializedRegistryPath } from '#core/global/registry-path/registry-path.js';
import { getErrorMessage } from '#utils/errors/errors.js';
import { pathExists } from '#utils/io/filesystem.js';
import { logger, type Logger } from '#utils/logging/logger.js';
import { spinnerFactory, type SpinnerFactory } from '#utils/cli/spinner.js';
import { formatChangeSummary, formatRelativeTime } from '#utils/formatting/ui.js';
import type { SkillPodConfig } from '#types/config.js';

const REMOTE_NAME = 'origin';
const REMOTE_BRANCH = 'main';

type ChangeKind = 'added' | 'modified' | 'removed';

interface ChangeSummary {
  added: string[];
  modified: string[];
  removed: string[];
}

export interface RegistryPrompts {
  search<T extends string>(
    message: string,
    choices: Array<{ value: T; name: string; description?: string }>,
  ): Promise<T>;
}

export interface PushRegistryOptions {
  skill?: string;
  all?: boolean;
}

export interface RegistryGitDependencies {
  github?: GitHubService;
  prompts?: RegistryPrompts;
  logger?: Logger;
  loadConfig?: () => Promise<SkillPodConfig>;
  spinner?: SpinnerFactory;
}

export interface PushRegistryResult {
  status: 'pushed' | 'up_to_date' | 'cancelled';
  commitMessage?: string | undefined;
  pushedSkill?: string | undefined;
}

export interface PullRegistryResult {
  status: 'pulled' | 'up_to_date' | 'cancelled';
  pulledSkill?: string | undefined;
  summary?: ChangeSummary | undefined;
}

const registryPrompts: RegistryPrompts = {
  async search<T extends string>(
    message: string,
    choices: Array<{ value: T; name: string; description?: string }>,
  ): Promise<T> {
    return search<T>({
      message,
      source(term) {
        const normalizedTerm = term?.trim().toLowerCase() ?? '';

        return choices.filter((choice) => {
          if (!normalizedTerm) {
            return true;
          }

          return choice.name.toLowerCase().includes(normalizedTerm);
        });
      },
    });
  },
};

function getGit(localRegistryPath: string): SimpleGit {
  return simpleGit(localRegistryPath);
}

function sanitizeVisibleText(value: string): string {
  return value.replace(/https:\/\/[^@\s]+@/g, 'https://***@');
}

function sanitizeCommitMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : createDefaultCommitMessage();
}

function createDefaultCommitMessage(): string {
  return `chore: update skills ${new Date().toISOString()}`;
}

function toRelativeDisplayPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function extractEntityName(filePath: string): string {
  const normalizedPath = toRelativeDisplayPath(filePath);
  const segments = normalizedPath.split('/');

  if (segments[0] === 'skills' && segments[1]) {
    return segments[1];
  }

  return normalizedPath;
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function createEmptySummary(): ChangeSummary {
  return {
    added: [],
    modified: [],
    removed: [],
  };
}

function classifyNameStatus(statusCode: string): ChangeKind {
  const normalized = statusCode.trim().toUpperCase();

  if (normalized === 'A' || normalized === 'C' || normalized === '?') {
    return 'added';
  }

  if (normalized === 'D') {
    return 'removed';
  }

  return 'modified';
}

function addChange(summary: ChangeSummary, kind: ChangeKind, entityName: string): void {
  if (kind === 'added') {
    pushUnique(summary.added, entityName);
    return;
  }

  if (kind === 'removed') {
    pushUnique(summary.removed, entityName);
    return;
  }

  pushUnique(summary.modified, entityName);
}

function parseStatusSummary(porcelain: string): ChangeSummary {
  const summary = createEmptySummary();
  const lines = porcelain
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const statusCode = line.slice(0, 2);
    const pathSection = line.slice(3).trim();
    const filePath = pathSection.includes(' -> ')
      ? (pathSection.split(' -> ').at(-1) ?? pathSection)
      : pathSection;
    const entityName = extractEntityName(filePath);
    const statusChars = statusCode.replace(/\s/g, '').split('');
    const effectiveStatuses = statusChars.length > 0 ? statusChars : ['M'];

    for (const statusChar of effectiveStatuses) {
      addChange(summary, classifyNameStatus(statusChar), entityName);
    }
  }

  return summary;
}

function parseNameStatusSummary(output: string): ChangeSummary {
  const summary = createEmptySummary();
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const [rawStatus, ...rawPathParts] = line.split('\t');
    const filePath = rawPathParts.join('\t').trim();

    if (!rawStatus || !filePath) {
      continue;
    }

    addChange(summary, classifyNameStatus(rawStatus.charAt(0)), extractEntityName(filePath));
  }

  return summary;
}

function formatSummary(summary: ChangeSummary, heading: string): string {
  return formatChangeSummary(summary, heading);
}

function isSummaryEmpty(summary: ChangeSummary): boolean {
  return (
    summary.added.length === 0 && summary.modified.length === 0 && summary.removed.length === 0
  );
}

async function assertRegistryReady(localRegistryPath: string): Promise<SimpleGit> {
  if (!(await pathExists(localRegistryPath))) {
    throw new Error('Local registry not found. Run "skillpod init" first.');
  }

  const git = getGit(localRegistryPath);
  const isRepo = await git.checkIsRepo();

  if (!isRepo) {
    throw new Error('Local registry is not a git repository. Run "skillpod init" first.');
  }

  const remotes = await git.getRemotes(true);
  const hasOrigin = remotes.some((remote) => remote.name === REMOTE_NAME);

  if (!hasOrigin) {
    throw new Error('Local registry has no git remote configured. Run "skillpod init" first.');
  }

  return git;
}

function createNetworkErrorMessage(errorMessage: string): string {
  const lowerMessage = errorMessage.toLowerCase();

  if (
    lowerMessage.includes('could not resolve host') ||
    lowerMessage.includes('failed to connect') ||
    lowerMessage.includes('network is unreachable') ||
    lowerMessage.includes('connection timed out')
  ) {
    return `${sanitizeVisibleText(errorMessage)} Check your network connection and try again.`;
  }

  return sanitizeVisibleText(errorMessage);
}

async function fetchRemote(git: SimpleGit): Promise<void> {
  await git.fetch(REMOTE_NAME, REMOTE_BRANCH);
}

interface LocalSkillEntry {
  name: string;
  hasChanges: boolean;
  lastModified: Date;
}

async function listLocalSkills(localRegistryPath: string): Promise<LocalSkillEntry[]> {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const skillsDir = path.join(localRegistryPath, 'skills');

  if (!(await pathExists(skillsDir))) {
    return [];
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const git = getGit(localRegistryPath);
  const skills: LocalSkillEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(skillsDir, entry.name);
    const stat = await fs.stat(skillPath);
    const statusOutput = await git.raw(['status', '--porcelain', '--', `skills/${entry.name}`]);
    const hasChanges = statusOutput.trim().length > 0;

    skills.push({
      name: entry.name,
      hasChanges,
      lastModified: stat.mtime,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function getUnmergedFiles(git: SimpleGit): Promise<string[]> {
  const output = await git.raw(['diff', '--name-only', '--diff-filter=U']);

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function getRegistryStatus(git: SimpleGit, skill?: string): Promise<string> {
  if (skill) {
    return git.raw(['status', '--porcelain', '--', `skills/${skill}`]);
  }

  return git.raw(['status', '--porcelain', '--untracked-files=all']);
}

export async function pushRegistry(
  options: PushRegistryOptions = {},
  dependencies: RegistryGitDependencies = {},
): Promise<PushRegistryResult> {
  const prompts = dependencies.prompts ?? registryPrompts;
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const spin = dependencies.spinner ?? spinnerFactory;
  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const git = await assertRegistryReady(localRegistryPath);
  const [localSkills, allChanges] = await Promise.all([
    listLocalSkills(localRegistryPath),
    getRegistryStatus(git),
  ]);
  const hasPendingChanges = allChanges.trim().length > 0;

  const now = new Date();
  const choices = localSkills.map((skill) => {
    const relative = formatRelativeTime(skill.lastModified, now);
    const statusLabel = skill.hasChanges ? chalk.yellow('unpushed') : chalk.green('synced');

    return {
      value: skill.name,
      name: `${skill.name}  ${statusLabel}`,
      description: relative,
    };
  });

  let selected: string;

  if (options.skill) {
    const skillChanges = await getRegistryStatus(git, options.skill);
    const hasSelectedSkillChanges = skillChanges.trim().length > 0;

    if (!localSkills.some((s) => s.name === options.skill) && !hasSelectedSkillChanges) {
      throw new Error(`Skill "${options.skill}" not found in local registry.`);
    }
    selected = options.skill;
  } else if (options.all) {
    selected = '__all__';
  } else if (localSkills.length === 0 && hasPendingChanges) {
    selected = '__all__';
  } else {
    if (localSkills.length === 0) {
      log.info('No local skills found. Create one with "skillpod create <name>".');
      return { status: 'up_to_date' };
    }

    selected = await prompts.search<string>('Select a skill to push', [
      ...choices,
      {
        value: '__all__',
        name: 'Push all changes',
        description: `${localSkills.filter((s) => s.hasChanges).length} with unpushed changes`,
      },
      {
        value: '__cancel__',
        name: 'Cancel',
        description: 'Do not push',
      },
    ]);

    if (selected === '__cancel__') {
      log.info('Push cancelled.');
      return { status: 'cancelled' };
    }
  }

  {
    const fetchSpinner = spin.create('Fetching remote...');
    fetchSpinner.start();

    try {
      await fetchRemote(git);
      fetchSpinner.succeed('Remote fetched');
    } catch (error) {
      fetchSpinner.fail('Failed to fetch remote');
      throw new Error(
        `Failed to contact the remote repository. ${createNetworkErrorMessage(getErrorMessage(error))}`,
      );
    }
  }

  if (selected === '__all__') {
    if (!hasPendingChanges) {
      log.info('All skills are already synced.');
      return { status: 'up_to_date' };
    }
  } else {
    const porcelain = await getRegistryStatus(git, selected);

    if (porcelain.trim().length === 0) {
      log.info(`Skill "${selected}" is already synced.`);
      return { status: 'up_to_date' };
    }
  }

  const commitMessage = sanitizeCommitMessage(
    selected === '__all__' ? createDefaultCommitMessage() : `chore: push skill "${selected}"`,
  );

  {
    const pushSpinner = spin.create('Pushing changes...');
    pushSpinner.start();

    try {
      if (selected === '__all__') {
        await git.add(['-A']);
      } else {
        await git.add([`skills/${selected}`]);
      }

      await git.commit(commitMessage);
      await git.push(REMOTE_NAME, REMOTE_BRANCH);
      pushSpinner.succeed('Changes pushed');
    } catch (error) {
      pushSpinner.fail('Push failed');
      throw new Error(
        `Failed to push registry changes. ${createNetworkErrorMessage(getErrorMessage(error))}`,
      );
    }
  }

  if (config.registryRepoUrl) {
    log.success(`Pushed to ${config.registryRepoUrl}`);
  } else {
    log.success('Pushed registry changes.');
  }

  return {
    status: 'pushed',
    commitMessage,
    pushedSkill: selected === '__all__' ? undefined : selected,
  };
}

export interface PullRegistryOptions {
  skill?: string;
  all?: boolean;
}

export async function pullRegistry(
  options: PullRegistryOptions = {},
  dependencies: RegistryGitDependencies = {},
): Promise<PullRegistryResult> {
  const prompts = dependencies.prompts ?? registryPrompts;
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const spin = dependencies.spinner ?? spinnerFactory;
  const github = dependencies.github ?? githubService;
  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const git = await assertRegistryReady(localRegistryPath);

  if (!config.githubToken || !config.githubUsername) {
    throw new Error('skillpod is not initialized. Run "skillpod init" first.');
  }

  const remoteSkills = await github.listRemoteSkills(
    config.githubToken,
    config.githubUsername,
    config.registryRepoName ?? 'skills',
  );

  if (remoteSkills.length === 0) {
    log.info('No remote skills found. Push some with "skillpod push".');
    return { status: 'up_to_date' };
  }

  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const now = new Date();

  const choices = await Promise.all(
    remoteSkills.map(async (name) => {
      const skillDir = path.join(localRegistryPath, 'skills', name);
      let description: string;

      if (await pathExists(skillDir)) {
        const stat = await fs.stat(skillDir);
        description = `${formatRelativeTime(stat.mtime, now)} · local copy exists`;
      } else {
        description = 'not pulled yet';
      }

      return { value: name, name, description };
    }),
  );

  let selected: string;

  if (options.skill) {
    if (!remoteSkills.includes(options.skill)) {
      throw new Error(`Skill "${options.skill}" not found in remote registry.`);
    }
    selected = options.skill;
  } else if (options.all) {
    selected = '__all__';
  } else {
    selected = await prompts.search<string>('Select a remote skill to pull', [
      ...choices,
      {
        value: '__all__',
        name: 'Pull all',
        description: `${remoteSkills.length} remote skill${remoteSkills.length === 1 ? '' : 's'}`,
      },
      {
        value: '__cancel__',
        name: 'Cancel',
        description: 'Do not pull',
      },
    ]);

    if (selected === '__cancel__') {
      log.info('Pull cancelled.');
      return { status: 'cancelled' };
    }
  }

  let beforeHead = '';

  {
    const fetchSpinner = spin.create('Fetching remote...');
    fetchSpinner.start();

    try {
      await fetchRemote(git);
      beforeHead = (await git.revparse(['HEAD'])).trim();
      fetchSpinner.succeed('Remote fetched');
    } catch (error) {
      fetchSpinner.fail('Failed to fetch remote');
      throw new Error(
        `Failed to contact the remote repository. ${createNetworkErrorMessage(getErrorMessage(error))}`,
      );
    }
  }

  {
    const pullSpinner = spin.create('Pulling changes...');
    pullSpinner.start();

    try {
      await git.pull(REMOTE_NAME, REMOTE_BRANCH, { '--no-rebase': null });
      pullSpinner.succeed('Changes pulled');
    } catch (error) {
      pullSpinner.fail('Pull failed');
      const conflicts = await getUnmergedFiles(git);

      if (conflicts.length > 0) {
        const visibleFiles = conflicts
          .map((filePath) => toRelativeDisplayPath(filePath))
          .join(', ');
        throw new Error(
          `Merge conflict detected in: ${visibleFiles}. Resolve the conflicts in ${localRegistryPath} and try again.`,
        );
      }

      throw new Error(
        `Failed to pull registry changes. ${createNetworkErrorMessage(getErrorMessage(error))}`,
      );
    }
  }

  const afterHead = (await git.revparse(['HEAD'])).trim();

  if (beforeHead === afterHead) {
    log.info('Registry is up to date.');
    return { status: 'up_to_date' };
  }

  const diffOutput = await git.diff(['--name-status', `${beforeHead}..${afterHead}`]);
  const summary = parseNameStatusSummary(diffOutput);

  log.success('Pull complete.');

  if (!isSummaryEmpty(summary)) {
    log.info(formatSummary(summary, 'Changes received:'));
  }

  return {
    status: 'pulled',
    pulledSkill: selected === '__all__' ? undefined : selected,
    summary,
  };
}

export const registryGitInternals = {
  createDefaultCommitMessage,
  createEmptySummary,
  extractEntityName,
  formatSummary,
  isSummaryEmpty,
  parseNameStatusSummary,
  parseStatusSummary,
  sanitizeCommitMessage,
  sanitizeVisibleText,
};
