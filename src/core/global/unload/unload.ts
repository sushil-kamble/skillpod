import { promises as fs } from 'node:fs';

import { confirm } from '@inquirer/prompts';

import { getConfigDirPath, loadConfig } from '#core/global/config/config.js';
import { logger, type Logger } from '#utils/logging/logger.js';
import { pathExists } from '#utils/io/filesystem.js';
import type { SkillPodConfig } from '#types/config.js';

export interface UnloadResult {
  status: 'completed' | 'cancelled' | 'nothing_to_unload';
  removedConfigDir: boolean;
  removedLocalRegistry: boolean;
}

export interface UnloadDependencies {
  prompts?: {
    confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  };
  logger?: Logger;
  loadConfig?: () => Promise<SkillPodConfig>;
  pathExists?: (targetPath: string) => Promise<boolean>;
  removeDirectory?: (targetPath: string) => Promise<void>;
  getConfigDirPath?: () => string;
}

const defaultPrompts = {
  async confirm(message: string, defaultValue = false): Promise<boolean> {
    return confirm({ message, default: defaultValue });
  },
};

async function removeDirectory(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export interface UnloadOptions {
  yes?: boolean;
}

export async function unloadSkillPod(
  options: UnloadOptions = {},
  dependencies: UnloadDependencies = {},
): Promise<UnloadResult> {
  const prompts = dependencies.prompts ?? defaultPrompts;
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const exists = dependencies.pathExists ?? pathExists;
  const remove = dependencies.removeDirectory ?? removeDirectory;
  const configDirPath = (dependencies.getConfigDirPath ?? getConfigDirPath)();

  const config = await readConfig();
  const configDirExists = await exists(configDirPath);
  const localRegistryPath = config.localRegistryPath;
  const localRegistryExists = localRegistryPath ? await exists(localRegistryPath) : false;

  if (!configDirExists && !localRegistryExists) {
    log.info('Nothing to unload. skillpod is not configured on this machine.');
    return { status: 'nothing_to_unload', removedConfigDir: false, removedLocalRegistry: false };
  }

  log.warn('This will permanently remove:');

  if (configDirExists) {
    log.warn(`  Config directory: ${configDirPath}`);
    log.warn('    (includes GitHub token and all settings)');
  }

  if (localRegistryExists && localRegistryPath) {
    log.warn(`  Local registry:   ${localRegistryPath}`);
    log.warn('    (local clone — your remote repository on GitHub is not affected)');
  }

  const shouldProceed =
    options.yes === true ||
    (await prompts.confirm('Are you sure you want to unload skillpod?', false));

  if (!shouldProceed) {
    log.info('Unload cancelled.');
    return { status: 'cancelled', removedConfigDir: false, removedLocalRegistry: false };
  }

  let removedLocalRegistry = false;
  let removedConfigDir = false;

  if (localRegistryExists && localRegistryPath) {
    await remove(localRegistryPath);
    log.success(`Removed local registry: ${localRegistryPath}`);
    removedLocalRegistry = true;
  }

  if (configDirExists) {
    await remove(configDirPath);
    log.success(`Removed config directory: ${configDirPath}`);
    removedConfigDir = true;
  }

  log.info('skillpod has been unloaded. Run "skillpod init" to set up again.');
  return { status: 'completed', removedConfigDir, removedLocalRegistry };
}
