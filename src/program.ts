import { Command } from 'commander';

import { registerCommands } from './commands/register-commands.js';
import { loadConfig } from './core/config.js';
import { ensureCommandInitialization } from './core/runtime.js';
import { logger, setDebugMode, type Logger } from './utils/logger.js';
import type { SkillForgeConfig } from './types/config.js';

type LoadConfig = () => Promise<SkillForgeConfig>;
type EnsureCommandInitialization = (
  commandName: string,
  readConfig: LoadConfig,
) => Promise<void>;
type RegisterCommands = (program: Command) => void;
type ProgramLogger = Pick<Logger, 'debug'>;

export interface CreateProgramDependencies {
  description?: string;
  ensureCommandInitialization?: EnsureCommandInitialization;
  loadConfig?: LoadConfig;
  logger?: ProgramLogger;
  name?: string;
  registerCommands?: RegisterCommands;
  setDebugMode?: (enabled: boolean) => void;
  version: string;
}

export function createProgram(dependencies: CreateProgramDependencies): Command {
  const description = dependencies.description ?? 'Author and manage a personal agent skills registry.';
  const initializeCommand =
    dependencies.ensureCommandInitialization ?? ensureCommandInitialization;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const log = dependencies.logger ?? logger;
  const name = dependencies.name ?? 'skill-forge';
  const register = dependencies.registerCommands ?? registerCommands;
  const setDebug = dependencies.setDebugMode ?? setDebugMode;
  const program = new Command();

  program.name(name).description(description).version(dependencies.version).option(
    '--debug',
    'Enable verbose logging',
  );

  program.hook('preAction', async (currentCommand, actionCommand) => {
    const options = currentCommand.optsWithGlobals<{ debug?: boolean }>();
    const commandName = actionCommand?.name() ?? currentCommand.name();

    setDebug(Boolean(options.debug));
    log.debug('Debug logging enabled');
    await initializeCommand(commandName, readConfig);
  });

  register(program);

  return program;
}
