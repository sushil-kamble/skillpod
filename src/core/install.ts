import { spawn } from 'node:child_process';

import { search } from '@inquirer/prompts';

import { loadConfig } from './config.js';
import { githubService, type GitHubService } from './github.js';
import { isInitializedConfig, INITIALIZATION_MESSAGE } from './registry-path.js';
import { getErrorMessage } from '../utils/errors.js';
import { logger, type Logger } from '../utils/logger.js';
import type { SkillPodConfig } from '../types/config.js';

export interface InstallSkillsOptions {
  agent?: string;
  copy?: boolean;
  global?: boolean;
  list?: boolean;
  skill?: string[];
  yes?: boolean;
}

export interface InstallRunner {
  run(command: string, args: string[]): Promise<void>;
}

export interface InstallPrompts {
  search<T extends string>(
    message: string,
    choices: Array<{ value: T; name: string; description?: string }>,
  ): Promise<T>;
}

export interface InstallDependencies {
  github?: GitHubService;
  loadConfig?: () => Promise<SkillPodConfig>;
  logger?: Logger;
  prompts?: InstallPrompts;
  runner?: InstallRunner;
}

export interface InstallResult {
  args: string[];
  registryTarget: string;
  selectedSkill?: string | undefined;
}

function ensureInstallConfig(
  config: SkillPodConfig,
  github: GitHubService,
): {
  githubToken: string;
  owner: string;
  repo: string;
} {
  if (!isInitializedConfig(config)) {
    throw new Error(INITIALIZATION_MESSAGE);
  }

  const repository = github.resolveRepositoryFromUrl(config.registryRepoUrl);

  return {
    githubToken: config.githubToken,
    owner: repository.owner,
    repo: repository.repo,
  };
}

const installRunner: InstallRunner = {
  async run(command: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'inherit',
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`The command exited with code ${code ?? 'unknown'}.`));
      });
    });
  },
};

const installPrompts: InstallPrompts = {
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

          const haystack = `${choice.name} ${choice.description ?? ''}`.toLowerCase();
          return haystack.includes(normalizedTerm);
        });
      },
    });
  },
};

function buildInstallArgs(registryTarget: string, options: InstallSkillsOptions): string[] {
  const args = ['skills', 'add', registryTarget];

  if (options.list) {
    args.push('--list');
  }

  if (options.skill) {
    for (const skillName of options.skill) {
      args.push('--skill', skillName);
    }
  }

  if (options.global) {
    args.push('-g');
  }

  if (options.agent) {
    args.push('--agent', options.agent);
  }

  if (options.yes) {
    args.push('-y');
  }

  if (options.copy) {
    args.push('--copy');
  }

  return args;
}

function isCommandNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function selectRemoteSkill(
  githubToken: string,
  owner: string,
  repo: string,
  github: GitHubService,
  prompts: InstallPrompts,
  log: Logger,
): Promise<string | null> {
  const remoteSkills = await github.listRemoteSkills(githubToken, owner, repo);

  if (remoteSkills.length === 0) {
    log.info('No skills found in the remote registry. Create one with "skillpod create <name>".');
    return null;
  }

  const selected = await prompts.search<string>('Select a skill to install', [
    ...remoteSkills.map((name) => ({
      value: name,
      name,
      description: 'Remote skill',
    })),
    {
      value: '__cancel__',
      name: 'Cancel',
      description: 'Stop without installing anything',
    },
  ]);

  if (selected === '__cancel__') {
    log.info('Install cancelled.');
    return null;
  }

  return selected;
}

export async function installSkills(
  options: InstallSkillsOptions = {},
  dependencies: InstallDependencies = {},
): Promise<InstallResult> {
  const github = dependencies.github ?? githubService;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const log = dependencies.logger ?? logger;
  const runner = dependencies.runner ?? installRunner;
  const prompts = dependencies.prompts ?? installPrompts;
  const config = await readConfig();
  const { githubToken, owner, repo } = ensureInstallConfig(config, github);
  const registryTarget = `${owner}/${repo}`;

  const repositoryStatus = await github.getRepositoryStatus(githubToken, owner, repo);

  if (repositoryStatus.isPrivate) {
    log.warn(
      'Your skills repository is private. skills.sh requires a public repo and may not be able to fetch it.',
    );
  }

  if (!repositoryStatus.hasSkillsDirectory) {
    log.warn(
      'Your GitHub skills registry has no pushed skills yet. You may need to run "skillpod push" first.',
    );
  }

  let selectedSkill: string | undefined;

  if (!options.skill && !options.list) {
    const chosen = await selectRemoteSkill(githubToken, owner, repo, github, prompts, log);

    if (!chosen) {
      return { args: [], registryTarget, selectedSkill: undefined };
    }

    selectedSkill = chosen;
    options = { ...options, skill: [chosen] };
  }

  const args = buildInstallArgs(registryTarget, options);

  try {
    await runner.run('npx', args);
  } catch (error) {
    if (isCommandNotFound(error)) {
      throw new Error(
        'Failed to run npx. Install Node.js and make sure "npx" is available in your PATH.',
      );
    }

    throw new Error(`Failed to run "npx ${args.join(' ')}". ${getErrorMessage(error)}`);
  }

  if (!options.list) {
    log.success('Your skills are now available in your agents.');
  }

  return {
    args,
    registryTarget,
    selectedSkill,
  };
}

export const installInternals = {
  buildInstallArgs,
};
