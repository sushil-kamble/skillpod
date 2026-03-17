import { spawn } from 'node:child_process';

import { loadConfig } from './config.js';
import { githubService, type GitHubService } from './github.js';
import { getErrorMessage } from '../utils/errors.js';
import { logger, type Logger } from '../utils/logger.js';
import type { SkillForgeConfig } from '../types/config.js';

const REGISTRY_REPO_NAME = 'skills';

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

export interface InstallDependencies {
  github?: GitHubService;
  loadConfig?: () => Promise<SkillForgeConfig>;
  logger?: Logger;
  runner?: InstallRunner;
}

export interface InstallResult {
  args: string[];
  registryTarget: string;
}

function ensureInstallConfig(config: SkillForgeConfig): {
  githubToken: string;
  githubUsername: string;
} {
  if (!config.githubToken || !config.githubUsername) {
    throw new Error('skill-forge is not initialized. Run "skill-forge init" first.');
  }

  return {
    githubToken: config.githubToken,
    githubUsername: config.githubUsername,
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

export async function installSkills(
  options: InstallSkillsOptions = {},
  dependencies: InstallDependencies = {},
): Promise<InstallResult> {
  const github = dependencies.github ?? githubService;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const log = dependencies.logger ?? logger;
  const runner = dependencies.runner ?? installRunner;
  const config = await readConfig();
  const { githubToken, githubUsername } = ensureInstallConfig(config);
  const registryTarget = `${githubUsername}/${REGISTRY_REPO_NAME}`;

  const repositoryStatus = await github.getRepositoryStatus(
    githubToken,
    githubUsername,
    REGISTRY_REPO_NAME,
  );

  if (repositoryStatus.isPrivate) {
    log.warn('Your skills repository is private. skills.sh requires a public repo and may not be able to fetch it.');
  }

  if (!repositoryStatus.hasSkillsDirectory) {
    log.warn('Your GitHub skills registry has no pushed skills yet. You may need to run "skill-forge push" first.');
  }

  const args = buildInstallArgs(registryTarget, options);

  try {
    await runner.run('npx', args);
  } catch (error) {
    if (isCommandNotFound(error)) {
      throw new Error('Failed to run npx. Install Node.js and make sure "npx" is available in your PATH.');
    }

    throw new Error(`Failed to run "npx ${args.join(' ')}". ${getErrorMessage(error)}`);
  }

  if (!options.list) {
    log.success('Your skills are now available in your agents.');
  }

  return {
    args,
    registryTarget,
  };
}

export const installInternals = {
  buildInstallArgs,
};
