import type { SkillPodConfig } from '../types/config.js';

export const INITIALIZATION_MESSAGE =
  'skillpod not initialized. Run `skillpod init` to get started.';

export function isInitializedConfig(config: SkillPodConfig): boolean {
  return (
    config.githubToken.length > 0 &&
    config.githubUsername.length > 0 &&
    config.registryRepoUrl.length > 0 &&
    config.localRegistryPath !== null &&
    config.registryRepoName !== null
  );
}

export function ensureInitializedRegistryPath(config: SkillPodConfig): string {
  if (!isInitializedConfig(config) || !config.localRegistryPath) {
    throw new Error(INITIALIZATION_MESSAGE);
  }

  return config.localRegistryPath;
}
