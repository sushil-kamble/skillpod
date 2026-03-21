import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { SkillPodConfig } from '#types/config.js';
import { getErrorMessage } from '#utils/errors/errors.js';

const CONFIG_DIR_NAME = '.skillpod';
const CONFIG_FILE_NAME = 'config.json';
const CONFIG_FILE_MODE = 0o600;

export function getConfigDirPath(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function getConfigFilePath(): string {
  return path.join(getConfigDirPath(), CONFIG_FILE_NAME);
}

function getDefaultConfig(): SkillPodConfig {
  return {
    githubToken: '',
    githubUsername: '',
    registryRepoUrl: '',
    localRegistryPath: null,
    registryRepoName: null,
  };
}

function normalizeConfig(input: Partial<SkillPodConfig>): SkillPodConfig {
  const defaults = getDefaultConfig();

  return {
    githubToken: typeof input.githubToken === 'string' ? input.githubToken : defaults.githubToken,
    githubUsername:
      typeof input.githubUsername === 'string' ? input.githubUsername : defaults.githubUsername,
    registryRepoUrl:
      typeof input.registryRepoUrl === 'string' ? input.registryRepoUrl : defaults.registryRepoUrl,
    localRegistryPath:
      typeof input.localRegistryPath === 'string' || input.localRegistryPath === null
        ? input.localRegistryPath
        : defaults.localRegistryPath,
    registryRepoName:
      typeof input.registryRepoName === 'string' || input.registryRepoName === null
        ? input.registryRepoName
        : defaults.registryRepoName,
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export async function loadConfig(): Promise<SkillPodConfig> {
  const configFilePath = getConfigFilePath();

  try {
    const rawConfig = await fs.readFile(configFilePath, 'utf8');
    const parsedConfig = JSON.parse(rawConfig) as Partial<SkillPodConfig>;

    return normalizeConfig(parsedConfig);
  } catch (error) {
    if (isMissingFileError(error)) {
      return getDefaultConfig();
    }

    throw new Error(`Failed to load config from ${configFilePath}: ${getErrorMessage(error)}`);
  }
}

export async function saveConfig(config: Partial<SkillPodConfig>): Promise<SkillPodConfig> {
  const normalizedConfig = normalizeConfig(config);
  const configDirPath = getConfigDirPath();
  const configFilePath = getConfigFilePath();

  try {
    await fs.mkdir(configDirPath, { recursive: true });
    await fs.writeFile(configFilePath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, {
      encoding: 'utf8',
      mode: CONFIG_FILE_MODE,
    });
    await fs.chmod(configFilePath, CONFIG_FILE_MODE);

    return normalizedConfig;
  } catch (error) {
    throw new Error(`Failed to save config to ${configFilePath}: ${getErrorMessage(error)}`);
  }
}
