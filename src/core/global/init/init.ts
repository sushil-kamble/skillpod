import os from 'node:os';
import path from 'node:path';

import { confirm, input, password, select } from '@inquirer/prompts';

import { loadConfig, saveConfig } from '#core/global/config/config.js';
import { gitService, type GitService } from '#core/global/git/git.js';
import {
  githubService,
  RepositoryAlreadyExistsError,
  type GitHubService,
  type RegistryRepository,
} from '#core/global/github/github.js';
import { isInitializedConfig } from '#core/global/registry-path/registry-path.js';
import { getErrorMessage } from '#utils/errors/errors.js';
import { logger, type Logger } from '#utils/logging/logger.js';
import { spinnerFactory, type SpinnerFactory } from '#utils/cli/spinner.js';
import { box, stepLabel } from '#utils/formatting/ui.js';
import type { SkillPodConfig } from '#types/config.js';

const DEFAULT_LOCAL_REGISTRY_PATH = path.join(os.homedir(), '.skillpod', 'registry');
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
  loadConfig?: () => Promise<SkillPodConfig>;
  saveConfig?: (config: Partial<SkillPodConfig>) => Promise<SkillPodConfig>;
  getLocalRegistryPath?: (config: SkillPodConfig) => string;
  spinner?: SpinnerFactory;
}

export interface InitFlowResult {
  status: 'completed' | 'cancelled';
  config?: SkillPodConfig;
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
  config: SkillPodConfig,
  getLocalRegistryPath: (config: SkillPodConfig) => string,
): string {
  return config.localRegistryPath ?? getLocalRegistryPath(config);
}

async function promptForGitHubToken(
  existingConfig: SkillPodConfig,
  prompts: PromptService,
  github: GitHubService,
  log: Logger,
  spin: SpinnerFactory,
): Promise<{ githubToken: string; githubUsername: string } | null> {
  if (existingConfig.githubToken.length > 0 && existingConfig.githubUsername.length > 0) {
    const tokenSpinner = spin.create(
      `Validating saved token for @${existingConfig.githubUsername}...`,
    );
    tokenSpinner.start();

    try {
      const validated = await github.validateToken(existingConfig.githubToken);
      tokenSpinner.succeed(`Authenticated as @${validated.githubUsername}`);
      return { githubToken: validated.githubToken, githubUsername: validated.githubUsername };
    } catch {
      tokenSpinner.fail('Saved token is no longer valid');
    }
  }

  for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const githubToken = (
      await prompts.password(
        `GitHub Personal Access Token (repo scope required). Create one at ${TOKEN_HELP_URL}\n  Press Enter to skip`,
      )
    ).trim();

    if (githubToken.length === 0) {
      log.warn('Skipping GitHub authentication. Some features will require a token later.');
      return null;
    }

    const tokenSpinner = spin.create('Validating token...');
    tokenSpinner.start();

    try {
      const validatedToken = await github.validateToken(githubToken);
      tokenSpinner.succeed(`Authenticated as @${validatedToken.githubUsername}`);
      return {
        githubToken: validatedToken.githubToken,
        githubUsername: validatedToken.githubUsername,
      };
    } catch (error) {
      tokenSpinner.fail('Token validation failed');
      log.error(getErrorMessage(error));

      if (attempt < MAX_TOKEN_ATTEMPTS) {
        log.warn(`${MAX_TOKEN_ATTEMPTS - attempt} attempt(s) remaining. Press Enter to skip.`);
      }
    }
  }

  throw new Error(
    `Unable to validate your GitHub token after ${MAX_TOKEN_ATTEMPTS} attempts. Run "skillpod init" again.`,
  );
}

async function promptForRepositoryMode(
  prompts: PromptService,
  hasToken: boolean,
  log: Logger,
): Promise<RegistrySetupMode> {
  if (!hasToken) {
    log.info('GitHub token not configured — using manual repository setup.');
    return 'manual';
  }

  return prompts.select<RegistrySetupMode>('How would you like to set up your registry?', [
    { name: 'Auto-create a public GitHub repo named "skills"', value: 'auto' },
    { name: 'Point at an existing GitHub repository (private or public)', value: 'manual' },
  ]);
}

async function promptForRepository(
  mode: RegistrySetupMode,
  prompts: PromptService,
  github: GitHubService,
  githubToken: string | null,
  githubUsername: string | null,
  log: Logger,
  spin: SpinnerFactory,
): Promise<RegistryRepository> {
  if (mode === 'auto' && githubToken) {
    const repoSpinner = spin.create('Creating skills repository...');
    repoSpinner.start();

    try {
      const repo = await github.createSkillsRepository(githubToken);
      repoSpinner.succeed('Repository created');
      return repo;
    } catch (error) {
      if (error instanceof RepositoryAlreadyExistsError && githubUsername) {
        repoSpinner.warn('Repository "skills" already exists on your account');

        const useExisting = await prompts.confirm('Use your existing "skills" repository?', true);

        if (useExisting) {
          const existingRepo = await github.getRepository(
            githubToken,
            `https://github.com/${githubUsername}/skills`,
          );
          log.success(`Using existing repository: ${existingRepo.htmlUrl}`);
          return existingRepo;
        }

        // User declined — fall through to manual URL entry below
      } else {
        repoSpinner.fail('Failed to create repository');
        throw error;
      }
    }
  }

  for (let attempt = 1; attempt <= MAX_REPO_URL_ATTEMPTS; attempt += 1) {
    const repoUrl = (
      await prompts.input(
        'GitHub repository URL (HTTPS), for example\n  https://github.com/<owner>/<repo>',
      )
    ).trim();

    try {
      if (githubToken) {
        return await github.getRepository(githubToken, repoUrl);
      }

      return github.resolveRepositoryFromUrl(repoUrl);
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
    `Unable to validate the repository after ${MAX_REPO_URL_ATTEMPTS} attempts. Run "skillpod init" again with a valid GitHub repository URL.`,
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
      `Local registry path already exists and is not a git repository: ${targetPath}. Remove it manually and run "skillpod init" again.`,
    );
  }

  if (!allowOverwrite) {
    throw new Error(
      `Local registry path already exists: ${targetPath}. Re-run "skillpod init" and confirm reinitialization to replace it.`,
    );
  }

  await git.removeDirectory(targetPath);
}

async function cloneRegistryRepository(
  repository: RegistryRepository,
  targetPath: string,
  git: GitService,
  spin: SpinnerFactory,
): Promise<void> {
  const cloneSpinner = spin.create('Cloning repository...');
  cloneSpinner.start();

  try {
    await git.cloneRepository(repository.cloneUrl, targetPath);
    cloneSpinner.succeed('Repository cloned');
  } catch (error) {
    cloneSpinner.fail('Clone failed');
    await git.removeDirectory(targetPath);
    throw new Error(
      `Failed to clone repository from ${repository.htmlUrl}. Check your network connection and repository access. ${getErrorMessage(error)}`,
    );
  }
}

export interface InitOptions {
  token?: string;
  repo?: string;
  yes?: boolean;
}

export async function initializeSkillPod(
  options: InitOptions = {},
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
  const spin = dependencies.spinner ?? spinnerFactory;

  const existingConfig = await readConfig();
  const alreadyInitialized = isInitializedConfig(existingConfig);

  if (alreadyInitialized) {
    const shouldReinitialize =
      options.yes === true ||
      (await prompts.confirm('skillpod is already initialized. Reinitialize?', false));

    if (!shouldReinitialize) {
      log.info('Initialization cancelled.');
      return { status: 'cancelled' };
    }
  }

  log.info(stepLabel(1, 4, 'GitHub authentication'));
  let tokenResult: { githubToken: string; githubUsername: string } | null;

  if (options.token) {
    const tokenSpinner = spin.create('Validating token...');
    tokenSpinner.start();

    try {
      const validated = await github.validateToken(options.token);
      tokenSpinner.succeed(`Authenticated as @${validated.githubUsername}`);
      tokenResult = {
        githubToken: validated.githubToken,
        githubUsername: validated.githubUsername,
      };
    } catch (error) {
      tokenSpinner.fail('Token validation failed');
      throw new Error(`Invalid token provided via --token flag. ${getErrorMessage(error)}`);
    }
  } else {
    tokenResult = await promptForGitHubToken(existingConfig, prompts, github, log, spin);
  }

  const githubToken = tokenResult?.githubToken ?? '';
  const githubUsername = tokenResult?.githubUsername ?? '';

  log.info(stepLabel(2, 4, 'Repository setup'));
  const setupMode: RegistrySetupMode = options.repo
    ? 'manual'
    : await promptForRepositoryMode(prompts, githubToken.length > 0, log);
  let repository: RegistryRepository;

  if (options.repo) {
    try {
      if (githubToken) {
        repository = await github.getRepository(githubToken, options.repo);
      } else {
        repository = github.resolveRepositoryFromUrl(options.repo);
      }
    } catch (error) {
      throw new Error(`Invalid repository URL provided via --repo flag. ${getErrorMessage(error)}`);
    }
  } else {
    repository = await promptForRepository(
      setupMode,
      prompts,
      github,
      githubToken || null,
      githubUsername || null,
      log,
      spin,
    );
  }
  const effectiveUsername = githubUsername || repository.owner;
  const localRegistryPath = getConfiguredLocalRegistryPath(
    existingConfig,
    resolveLocalRegistryPath,
  );

  log.info(stepLabel(3, 4, 'Cloning registry'));
  await prepareLocalRegistryPath(localRegistryPath, git, alreadyInitialized);
  await cloneRegistryRepository(repository, localRegistryPath, git, spin);
  await git.ensureSkillsDirectory(localRegistryPath, effectiveUsername);

  log.info(stepLabel(4, 4, 'Saving configuration'));
  const savedConfig = await writeConfig({
    githubToken,
    githubUsername: effectiveUsername,
    registryRepoUrl: repository.htmlUrl,
    localRegistryPath,
    registryRepoName: REPOSITORY_NAME,
  });

  log.info(
    box(
      `skillpod initialization complete.\n\nRepository: ${repository.htmlUrl}\nLocal registry: ${localRegistryPath}`,
    ),
  );

  return {
    status: 'completed',
    config: savedConfig,
    repository,
  };
}
