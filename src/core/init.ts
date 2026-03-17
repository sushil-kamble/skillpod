import os from 'node:os';
import path from 'node:path';

import { confirm, input, password, select } from '@inquirer/prompts';

import { loadConfig, saveConfig } from './config.js';
import { gitService, type GitService } from './git.js';
import { githubService, type GitHubService, type RegistryRepository } from './github.js';
import { isInitializedConfig } from './registry-path.js';
import { getErrorMessage } from '../utils/errors.js';
import { logger, type Logger } from '../utils/logger.js';
import type { SkillForgeConfig } from '../types/config.js';

const DEFAULT_LOCAL_REGISTRY_PATH = path.join(os.homedir(), '.skill-forge', 'registry');
const REPOSITORY_NAME = 'skills';
const TOKEN_HELP_URL = 'https://github.com/settings/tokens/new';
const MAX_TOKEN_ATTEMPTS = 3;
const MAX_REPO_URL_ATTEMPTS = 3;

type RegistrySetupMode = 'auto' | 'manual';

export interface PromptChoice<T extends string> {
  name: string;
  value: T;
}

export interface PromptService {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  password(message: string): Promise<string>;
  input(message: string): Promise<string>;
  select<T extends string>(message: string, choices: PromptChoice<T>[]): Promise<T>;
}

export interface InitFlowDependencies {
  prompts?: PromptService;
  github?: GitHubService;
  git?: GitService;
  logger?: Logger;
  loadConfig?: () => Promise<SkillForgeConfig>;
  saveConfig?: (config: Partial<SkillForgeConfig>) => Promise<SkillForgeConfig>;
  getLocalRegistryPath?: (config: SkillForgeConfig) => string;
}

export interface InitFlowResult {
  status: 'completed' | 'cancelled';
  config?: SkillForgeConfig;
  repository?: RegistryRepository;
}

const promptService: PromptService = {
  async confirm(message: string, defaultValue = false): Promise<boolean> {
    return confirm({ message, default: defaultValue });
  },

  async password(message: string): Promise<string> {
    return password({ message, mask: '*' });
  },

  async input(message: string): Promise<string> {
    return input({ message });
  },

  async select<T extends string>(message: string, choices: PromptChoice<T>[]): Promise<T> {
    return select({ message, choices });
  },
};

function getConfiguredLocalRegistryPath(
  config: SkillForgeConfig,
  getLocalRegistryPath: (config: SkillForgeConfig) => string,
): string {
  return config.localRegistryPath ?? getLocalRegistryPath(config);
}

async function promptForGitHubToken(
  prompts: PromptService,
  github: GitHubService,
  log: Logger,
): Promise<{ githubToken: string; githubUsername: string }> {
  for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const githubToken = (await prompts.password(
      `GitHub Personal Access Token (repo scope required). Create one at ${TOKEN_HELP_URL}`,
    )).trim();

    if (githubToken.length === 0) {
      log.error('A GitHub token is required.');
      continue;
    }

    try {
      const validatedToken = await github.validateToken(githubToken);
      return {
        githubToken: validatedToken.githubToken,
        githubUsername: validatedToken.githubUsername,
      };
    } catch (error) {
      log.error(getErrorMessage(error));

      if (attempt < MAX_TOKEN_ATTEMPTS) {
        log.warn(`Token validation failed. ${MAX_TOKEN_ATTEMPTS - attempt} attempt(s) remaining.`);
      }
    }
  }

  throw new Error(
    `Unable to validate your GitHub token after ${MAX_TOKEN_ATTEMPTS} attempts. Create a Personal Access Token with the "repo" scope and run "skill-forge init" again.`,
  );
}

async function promptForRepositoryMode(prompts: PromptService): Promise<RegistrySetupMode> {
  return prompts.select<RegistrySetupMode>('How would you like to set up your registry?', [
    { name: 'Auto-create a public GitHub repo named "skills"', value: 'auto' },
    { name: 'Point at an existing GitHub repository', value: 'manual' },
  ]);
}

async function promptForRepository(
  mode: RegistrySetupMode,
  prompts: PromptService,
  github: GitHubService,
  githubToken: string,
  log: Logger,
): Promise<RegistryRepository> {
  if (mode === 'auto') {
    return github.createSkillsRepository(githubToken);
  }

  for (let attempt = 1; attempt <= MAX_REPO_URL_ATTEMPTS; attempt += 1) {
    const repoUrl = (await prompts.input(
      'GitHub repository URL (HTTPS), for example https://github.com/<owner>/<repo>',
    )).trim();

    try {
      return await github.getRepository(githubToken, repoUrl);
    } catch (error) {
      log.error(getErrorMessage(error));

      if (attempt < MAX_REPO_URL_ATTEMPTS) {
        log.warn(
          `Repository validation failed. ${MAX_REPO_URL_ATTEMPTS - attempt} attempt(s) remaining.`,
        );
      }
    }
  }

  throw new Error(
    `Unable to validate the repository after ${MAX_REPO_URL_ATTEMPTS} attempts. Run "skill-forge init" again with a valid GitHub repository URL.`,
  );
}

async function prepareLocalRegistryPath(
  targetPath: string,
  git: GitService,
  allowOverwrite: boolean,
): Promise<void> {
  const exists = await git.pathExists(targetPath);

  if (!exists) {
    return;
  }

  const isRepository = await git.isGitRepository(targetPath);

  if (!isRepository) {
    throw new Error(
      `Local registry path already exists and is not a git repository: ${targetPath}. Remove it manually and run "skill-forge init" again.`,
    );
  }

  if (!allowOverwrite) {
    throw new Error(
      `Local registry path already exists: ${targetPath}. Re-run "skill-forge init" and confirm reinitialization to replace it.`,
    );
  }

  await git.removeDirectory(targetPath);
}

async function cloneRegistryRepository(
  repository: RegistryRepository,
  targetPath: string,
  git: GitService,
): Promise<void> {
  try {
    await git.cloneRepository(repository.cloneUrl, targetPath);
  } catch (error) {
    await git.removeDirectory(targetPath);
    throw new Error(
      `Failed to clone repository from ${repository.htmlUrl}. Check your network connection and repository access. ${getErrorMessage(error)}`,
    );
  }
}

export async function initializeSkillForge(
  dependencies: InitFlowDependencies = {},
): Promise<InitFlowResult> {
  const prompts = dependencies.prompts ?? promptService;
  const github = dependencies.github ?? githubService;
  const git = dependencies.git ?? gitService;
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const writeConfig = dependencies.saveConfig ?? saveConfig;
  const resolveLocalRegistryPath =
    dependencies.getLocalRegistryPath ?? (() => DEFAULT_LOCAL_REGISTRY_PATH);

  const existingConfig = await readConfig();
  const alreadyInitialized = isInitializedConfig(existingConfig);

  if (alreadyInitialized) {
    const shouldReinitialize = await prompts.confirm('skill-forge is already initialized. Reinitialize?', false);

    if (!shouldReinitialize) {
      log.info('Initialization cancelled.');
      return { status: 'cancelled' };
    }
  }

  const { githubToken, githubUsername } = await promptForGitHubToken(prompts, github, log);
  const setupMode = await promptForRepositoryMode(prompts);
  const repository = await promptForRepository(setupMode, prompts, github, githubToken, log);
  const localRegistryPath = getConfiguredLocalRegistryPath(existingConfig, resolveLocalRegistryPath);

  await prepareLocalRegistryPath(localRegistryPath, git, alreadyInitialized);
  await cloneRegistryRepository(repository, localRegistryPath, git);
  await git.ensureSkillsDirectory(localRegistryPath, githubUsername);

  const savedConfig = await writeConfig({
    githubToken,
    githubUsername,
    registryRepoUrl: repository.htmlUrl,
    localRegistryPath,
    registryRepoName: REPOSITORY_NAME,
  });

  log.success('skill-forge initialization complete.');
  log.info(`Repository: ${repository.htmlUrl}`);
  log.info(`Local registry: ${localRegistryPath}`);

  return {
    status: 'completed',
    config: savedConfig,
    repository,
  };
}
