import { Command } from 'commander';

import { installSkills } from '../core/install.js';

export const installCommand = new Command('install')
  .description('Install skills into an agent')
  .option('--list', 'List available skills from the registry')
  .option('--skill <name>', 'Install one skill from the registry', (value: string, previous: string[] = []) => [
    ...previous,
    value,
  ])
  .option('-g, --global', 'Install at user scope')
  .option('-a, --agent <agent>', 'Target a specific agent')
  .option('-y, --yes', 'Skip confirmation prompts in the skills CLI')
  .option('--copy', 'Copy files instead of symlinking')
  .action(async (options: {
    agent?: string;
    copy?: boolean;
    global?: boolean;
    list?: boolean;
    skill?: string[];
    yes?: boolean;
  }) => {
    await installSkills({
      ...(options.agent ? { agent: options.agent } : {}),
      ...(options.copy ? { copy: true } : {}),
      ...(options.global ? { global: true } : {}),
      ...(options.list ? { list: true } : {}),
      ...(options.skill ? { skill: options.skill } : {}),
      ...(options.yes ? { yes: true } : {}),
    });
  });
