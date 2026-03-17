import type { SkillForgeConfig } from '../types/config.js';

export const INITIALIZATION_MESSAGE = 'skill-forge not initialized. Run `skill-forge init` to get started.';

export function isInitializedConfig(config: SkillForgeConfig): boolean {
  return (
    config.githubToken.length > 0 &&
    config.githubUsername.length > 0 &&
    config.registryRepoUrl.length > 0 &&
    config.localRegistryPath !== null &&
    config.registryRepoName !== null
  );
}

export function ensureInitializedRegistryPath(config: SkillForgeConfig): string {
  if (!isInitializedConfig(config) || !config.localRegistryPath) {
    throw new Error(INITIALIZATION_MESSAGE);
  }

  return config.localRegistryPath;
}
