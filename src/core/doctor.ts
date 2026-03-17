import { promises as fs } from 'node:fs';

import { simpleGit } from 'simple-git';

import { getConfigFilePath, loadConfig } from './config.js';
import { githubService, type GitHubService } from './github.js';
import { INITIALIZATION_MESSAGE, isInitializedConfig } from './registry-path.js';
import { resolveExecutable } from '../utils/command.js';
import { getErrorMessage } from '../utils/errors.js';
import { pathExists } from '../utils/filesystem.js';
import { logger, type Logger } from '../utils/logger.js';
import type { SkillForgeConfig } from '../types/config.js';

type DoctorStatus = 'fail' | 'pass' | 'unreachable';

export interface DoctorCheck {
  detail: string;
  label: string;
  status: DoctorStatus;
}

export interface DoctorGitClient {
  checkIsRepo(): Promise<boolean>;
  listRemote(args?: string[]): Promise<string>;
}

export interface DoctorDependencies {
  configFilePath?: string;
  github?: GitHubService;
  loadConfig?: () => Promise<SkillForgeConfig>;
  logger?: Logger;
  makeGit?: (directory: string) => DoctorGitClient;
  pathExists?: (targetPath: string) => Promise<boolean>;
  readFile?: (filePath: string) => Promise<string>;
  resolveExecutable?: (command: string) => Promise<string | null>;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  ok: boolean;
}

function createPass(label: string, detail: string): DoctorCheck {
  return { label, detail, status: 'pass' };
}

function createFail(label: string, detail: string): DoctorCheck {
  return { label, detail, status: 'fail' };
}

function createUnreachable(label: string, detail: string): DoctorCheck {
  return { label, detail, status: 'unreachable' };
}

function formatCheck(check: DoctorCheck): string {
  const prefix =
    check.status === 'pass' ? 'PASS' : check.status === 'fail' ? 'FAIL' : 'UNREACHABLE';

  return `${prefix} ${check.label}: ${check.detail}`;
}

function looksUnreachable(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();

  return (
    normalized.includes('rate limit') ||
    normalized.includes('could not resolve host') ||
    normalized.includes('failed to connect') ||
    normalized.includes('network is unreachable') ||
    normalized.includes('timed out') ||
    normalized.includes('econnrefused') ||
    normalized.includes('enotfound') ||
    normalized.includes('unreachable')
  );
}

export async function runDoctor(
  dependencies: DoctorDependencies = {},
): Promise<DoctorResult> {
  const configFilePath = dependencies.configFilePath ?? getConfigFilePath();
  const github = dependencies.github ?? githubService;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const log = dependencies.logger ?? logger;
  const exists = dependencies.pathExists ?? pathExists;
  const readFile =
    dependencies.readFile ?? (async (filePath: string) => fs.readFile(filePath, 'utf8'));
  const findExecutable = dependencies.resolveExecutable ?? resolveExecutable;
  const makeGit =
    dependencies.makeGit ??
    ((directory: string) => simpleGit(directory));

  const checks: DoctorCheck[] = [];
  const hasConfigFile = await exists(configFilePath);
  let config: SkillForgeConfig | null = null;

  if (!hasConfigFile) {
    checks.push(createFail('Config file', `${INITIALIZATION_MESSAGE}`));
  } else {
    try {
      await readFile(configFilePath);
      config = await readConfig();

      if (isInitializedConfig(config)) {
        checks.push(createPass('Config file', `Valid config found at ${configFilePath}`));
      } else {
        checks.push(createFail('Config file', `${INITIALIZATION_MESSAGE}`));
      }
    } catch (error) {
      checks.push(createFail('Config file', `Failed to read config: ${getErrorMessage(error)}`));
    }
  }

  if (config === null && hasConfigFile) {
    try {
      config = await readConfig();
    } catch {
      config = null;
    }
  }

  if (config && isInitializedConfig(config) && config.localRegistryPath) {
    const registryExists = await exists(config.localRegistryPath);

    if (!registryExists) {
      checks.push(createFail('Local registry', `Directory not found at ${config.localRegistryPath}`));
    } else {
      try {
        const git = makeGit(config.localRegistryPath);
        const isRepo = await git.checkIsRepo();

        if (!isRepo) {
          checks.push(createFail('Local registry', `Path exists but is not a git repo: ${config.localRegistryPath}`));
        } else {
          checks.push(createPass('Local registry', `Git repository found at ${config.localRegistryPath}`));
        }
      } catch (error) {
        checks.push(createFail('Local registry', `Failed to inspect git repo: ${getErrorMessage(error)}`));
      }
    }

    try {
      await github.validateToken(config.githubToken);
      checks.push(createPass('GitHub token', 'Token is valid.'));
    } catch (error) {
      const message = getErrorMessage(error);

      if (looksUnreachable(message)) {
        checks.push(createUnreachable('GitHub token', `GitHub API unreachable: ${message}`));
      } else {
        checks.push(createFail('GitHub token', message));
      }
    }

    try {
      const git = makeGit(config.localRegistryPath);
      await git.listRemote(['--heads', 'origin']);
      checks.push(createPass('Remote repository', 'Origin remote is reachable.'));
    } catch (error) {
      checks.push(createFail('Remote repository', `Failed to reach origin: ${getErrorMessage(error)}`));
    }
  } else {
    checks.push(createFail('Local registry', INITIALIZATION_MESSAGE));
    checks.push(createFail('GitHub token', INITIALIZATION_MESSAGE));
    checks.push(createFail('Remote repository', INITIALIZATION_MESSAGE));
  }

  const npxPath = await findExecutable('npx');

  if (npxPath) {
    checks.push(createPass('npx', `Found at ${npxPath}`));
  } else {
    checks.push(createFail('npx', 'npx is not available in PATH. Install Node.js and try again.'));
  }

  checks.forEach((check) => {
    log.info(formatCheck(check));
  });

  return {
    checks,
    ok: checks.every((check) => check.status === 'pass'),
  };
}
