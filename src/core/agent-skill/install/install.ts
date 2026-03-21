import { spawn } from 'node:child_process';

import { search } from '@inquirer/prompts';

import { loadConfig } from '#core/global/config/config.js';
import { githubService, type GitHubService } from '#core/global/github/github.js';
import {
  isInitializedConfig,
  INITIALIZATION_MESSAGE,
} from '#core/global/registry-path/registry-path.js';
import { getErrorMessage } from '#utils/errors/errors.js';
import { logger, type Logger } from '#utils/logging/logger.js';
import type { SkillPodConfig } from '#types/config.js';

export interface InstallSkillsOptions {
  skill?: string;
  passthrough?: string[];
}

export interface InstallRunner {
  run(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void>;
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
  async run(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'inherit',
        env: env ?? process.env,
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

function buildInstallArgs(registryTarget: string, skill: string, passthrough: string[]): string[] {
  return ['skills', 'add', registryTarget, '--skill', skill, ...passthrough];
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
    if (githubToken) {
      log.info('Your skills repository is private. Authenticating with your stored GitHub token.');
    } else {
      log.warn(
        'Your skills repository is private and no GitHub token is configured. Installation may fail.',
      );
    }
  }

  if (!repositoryStatus.hasSkillsDirectory) {
    log.warn(
      'Your GitHub skills registry has no pushed skills yet. You may need to run "skillpod push" first.',
    );
  }

  let selectedSkill: string | undefined;

  if (options.skill) {
    const remoteSkills = await github.listRemoteSkills(githubToken, owner, repo);

    if (!remoteSkills.includes(options.skill)) {
      if (remoteSkills.length > 0) {
        const skillList = remoteSkills.map((s) => `  - ${s}`).join('\n');
        throw new Error(
          `Skill "${options.skill}" not found in the remote registry.\n\nAvailable skills:\n${skillList}`,
        );
      }

      throw new Error(
        `Skill "${options.skill}" not found. No skills are available in the remote registry.`,
      );
    }

    selectedSkill = options.skill;
  } else {
    const chosen = await selectRemoteSkill(githubToken, owner, repo, github, prompts, log);

    if (!chosen) {
      return { args: [], registryTarget, selectedSkill: undefined };
    }

    selectedSkill = chosen;
  }

  const args = buildInstallArgs(registryTarget, selectedSkill, options.passthrough ?? []);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (repositoryStatus.isPrivate && githubToken) {
    env['GITHUB_TOKEN'] = githubToken;
    env['GH_TOKEN'] = githubToken;
    env['GIT_CONFIG_COUNT'] = '1';
    env['GIT_CONFIG_KEY_0'] = `url.https://${githubToken}@github.com/.insteadOf`;
    env['GIT_CONFIG_VALUE_0'] = 'https://github.com/';
  }

  try {
    await runner.run('npx', args, env);
  } catch (error) {
    if (isCommandNotFound(error)) {
      throw new Error(
        'Failed to run npx. Install Node.js and make sure "npx" is available in your PATH.',
      );
    }

    throw new Error(`Failed to run "npx ${args.join(' ')}". ${getErrorMessage(error)}`);
  }

  log.success('Your skills are now available in your agents.');

  return {
    args,
    registryTarget,
    selectedSkill,
  };
}

export const installInternals = {
  buildInstallArgs,
};
