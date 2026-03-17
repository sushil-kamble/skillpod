import type { SkillForgeConfig } from '../types/config.js';

export function ensureInitializedRegistryPath(config: SkillForgeConfig): string {
  if (!config.localRegistryPath) {
    throw new Error('skill-forge is not initialized. Run "skill-forge init" first.');
  }

  return config.localRegistryPath;
}
