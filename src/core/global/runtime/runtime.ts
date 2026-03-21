import { loadConfig } from '#core/global/config/config.js';
import {
  INITIALIZATION_MESSAGE,
  isInitializedConfig,
} from '#core/global/registry-path/registry-path.js';
import type { SkillPodConfig } from '#types/config.js';

const MINIMUM_NODE_MAJOR = 20;
const INITIALIZATION_EXEMPT_COMMANDS = new Set(['doctor', 'help', 'init', 'unload']);

export function assertSupportedNodeVersion(version = process.versions.node): void {
  const majorVersion = Number.parseInt(version.split('.')[0] ?? '0', 10);

  if (Number.isNaN(majorVersion) || majorVersion < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `skillpod requires Node.js ${MINIMUM_NODE_MAJOR} or newer. Upgrade Node.js and try again.`,
    );
  }
}

export function commandRequiresInitialization(commandName: string): boolean {
  return !INITIALIZATION_EXEMPT_COMMANDS.has(commandName);
}

export async function ensureCommandInitialization(
  commandName: string,
  readConfig: () => Promise<SkillPodConfig> = loadConfig,
): Promise<void> {
  if (!commandRequiresInitialization(commandName)) {
    return;
  }

  const config = await readConfig();

  if (!isInitializedConfig(config)) {
    throw new Error(INITIALIZATION_MESSAGE);
  }
}
