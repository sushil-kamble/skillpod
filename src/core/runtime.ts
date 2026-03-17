import { loadConfig } from './config.js';
import { INITIALIZATION_MESSAGE, isInitializedConfig } from './registry-path.js';
import type { SkillForgeConfig } from '../types/config.js';

const MINIMUM_NODE_MAJOR = 18;
const INITIALIZATION_EXEMPT_COMMANDS = new Set(['doctor', 'help', 'init']);

export function assertSupportedNodeVersion(version = process.versions.node): void {
  const majorVersion = Number.parseInt(version.split('.')[0] ?? '0', 10);

  if (Number.isNaN(majorVersion) || majorVersion < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `skill-forge requires Node.js ${MINIMUM_NODE_MAJOR} or newer. Upgrade Node.js and try again.`,
    );
  }
}

export function commandRequiresInitialization(commandName: string): boolean {
  return !INITIALIZATION_EXEMPT_COMMANDS.has(commandName);
}

export async function ensureCommandInitialization(
  commandName: string,
  readConfig: () => Promise<SkillForgeConfig> = loadConfig,
): Promise<void> {
  if (!commandRequiresInitialization(commandName)) {
    return;
  }

  const config = await readConfig();

  if (!isInitializedConfig(config)) {
    throw new Error(INITIALIZATION_MESSAGE);
  }
}
