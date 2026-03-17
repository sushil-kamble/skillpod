import path from 'node:path';

import { confirm } from '@inquirer/prompts';
import { simpleGit, type SimpleGit } from 'simple-git';

import { loadConfig } from './config.js';
import { ensureInitializedRegistryPath } from './registry-path.js';
import { getErrorMessage } from '../utils/errors.js';
import { logger, type Logger } from '../utils/logger.js';
import { pathExists } from '../utils/filesystem.js';
import type { SkillForgeConfig } from '../types/config.js';

const REMOTE_NAME = 'origin';
const REMOTE_BRANCH = 'main';

type ChangeKind = 'added' | 'modified' | 'removed';

interface ChangeSummary {
  added: string[];
  modified: string[];
  removed: string[];
}

export interface RegistryPrompts {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
}

export interface PushRegistryOptions {
  message?: string;
}

export interface RegistryGitDependencies {
  prompts?: RegistryPrompts;
  logger?: Logger;
  loadConfig?: () => Promise<SkillForgeConfig>;
}

export interface PushRegistryResult {
  status: 'pushed' | 'up_to_date';
  commitMessage?: string;
  summary?: ChangeSummary;
}

export interface SyncRegistryResult {
  status: 'synced' | 'up_to_date';
  summary: ChangeSummary;
}

const registryPrompts: RegistryPrompts = {
  async confirm(message: string, defaultValue = true): Promise<boolean> {
    return confirm({
      message,
      default: defaultValue,
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
    const filePath = pathSection.includes(' -> ') ? pathSection.split(' -> ').at(-1) ?? pathSection : pathSection;
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
  const lines = [heading];

  if (summary.added.length > 0) {
    lines.push(`Added: ${summary.added.join(', ')}`);
  }

  if (summary.modified.length > 0) {
    lines.push(`Modified: ${summary.modified.join(', ')}`);
  }

  if (summary.removed.length > 0) {
    lines.push(`Removed: ${summary.removed.join(', ')}`);
  }

  return lines.join('\n');
}

function isSummaryEmpty(summary: ChangeSummary): boolean {
  return summary.added.length === 0 && summary.modified.length === 0 && summary.removed.length === 0;
}

async function assertRegistryReady(localRegistryPath: string): Promise<SimpleGit> {
  if (!(await pathExists(localRegistryPath))) {
    throw new Error('Local registry not found. Run "skill-forge init" first.');
  }

  const git = getGit(localRegistryPath);
  const isRepo = await git.checkIsRepo();

  if (!isRepo) {
    throw new Error('Local registry is not a git repository. Run "skill-forge init" first.');
  }

  const remotes = await git.getRemotes(true);
  const hasOrigin = remotes.some((remote) => remote.name === REMOTE_NAME);

  if (!hasOrigin) {
    throw new Error('Local registry has no git remote configured. Run "skill-forge init" first.');
  }

  return git;
}

async function getAheadBehindCounts(git: SimpleGit): Promise<{ ahead: number; behind: number }> {
  const output = await git.raw(['rev-list', '--left-right', '--count', `HEAD...${REMOTE_NAME}/${REMOTE_BRANCH}`]);
  const [aheadRaw, behindRaw] = output.trim().split(/\s+/);

  return {
    ahead: Number.parseInt(aheadRaw ?? '0', 10) || 0,
    behind: Number.parseInt(behindRaw ?? '0', 10) || 0,
  };
}

async function getUnmergedFiles(git: SimpleGit): Promise<string[]> {
  const output = await git.raw(['diff', '--name-only', '--diff-filter=U']);

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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

export async function pushRegistry(
  options: PushRegistryOptions = {},
  dependencies: RegistryGitDependencies = {},
): Promise<PushRegistryResult> {
  const prompts = dependencies.prompts ?? registryPrompts;
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const git = await assertRegistryReady(localRegistryPath);

  try {
    await fetchRemote(git);
  } catch (error) {
    throw new Error(`Failed to contact the remote repository. ${createNetworkErrorMessage(getErrorMessage(error))}`);
  }

  const aheadBehind = await getAheadBehindCounts(git);

  if (aheadBehind.behind > 0) {
    throw new Error('Remote changes exist that are not in your local registry. Run "skill-forge sync" first.');
  }

  const porcelain = await git.raw(['status', '--porcelain', '--untracked-files=all']);

  if (porcelain.trim().length === 0) {
    log.info('Registry is up to date');
    return { status: 'up_to_date' };
  }

  const summary = parseStatusSummary(porcelain);
  log.info(formatSummary(summary, 'Pending registry changes:'));

  const shouldPush = await prompts.confirm('Push these changes?', true);

  if (!shouldPush) {
    log.info('Push cancelled.');
    return {
      status: 'up_to_date',
      summary,
    };
  }

  const commitMessage = sanitizeCommitMessage(options.message ?? createDefaultCommitMessage());

  try {
    await git.add(['-A']);
    await git.commit(commitMessage);
    await git.push(REMOTE_NAME, REMOTE_BRANCH);
  } catch (error) {
    throw new Error(`Failed to push registry changes. ${createNetworkErrorMessage(getErrorMessage(error))}`);
  }

  if (config.registryRepoUrl) {
    log.success(`Pushed registry changes to ${config.registryRepoUrl}`);
  } else {
    log.success('Pushed registry changes.');
  }

  return {
    status: 'pushed',
    commitMessage,
    summary,
  };
}

export async function syncRegistry(
  dependencies: RegistryGitDependencies = {},
): Promise<SyncRegistryResult> {
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const git = await assertRegistryReady(localRegistryPath);

  let beforeHead = '';

  try {
    await fetchRemote(git);
    beforeHead = (await git.revparse(['HEAD'])).trim();
  } catch (error) {
    throw new Error(`Failed to contact the remote repository. ${createNetworkErrorMessage(getErrorMessage(error))}`);
  }

  try {
    await git.pull(REMOTE_NAME, REMOTE_BRANCH, { '--no-rebase': null });
  } catch (error) {
    const conflicts = await getUnmergedFiles(git);

    if (conflicts.length > 0) {
      const visibleFiles = conflicts.map((filePath) => toRelativeDisplayPath(filePath)).join(', ');
      throw new Error(
        `Merge conflict detected in: ${visibleFiles}. Resolve the conflicts in ${localRegistryPath} and run "skill-forge sync" again.`,
      );
    }

    throw new Error(`Failed to sync registry changes. ${createNetworkErrorMessage(getErrorMessage(error))}`);
  }

  const afterHead = (await git.revparse(['HEAD'])).trim();

  if (beforeHead === afterHead) {
    log.info('Registry is up to date');
    return {
      status: 'up_to_date',
      summary: createEmptySummary(),
    };
  }

  const diffOutput = await git.diff(['--name-status', `${beforeHead}..${afterHead}`]);
  const summary = parseNameStatusSummary(diffOutput);

  log.success('Registry synced successfully.');

  if (!isSummaryEmpty(summary)) {
    log.info(formatSummary(summary, 'Remote changes received:'));
  }

  return {
    status: 'synced',
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
