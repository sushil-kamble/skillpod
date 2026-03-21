import { Command } from 'commander';

import { pullRegistry } from '#core/agent-skill/registry-git/registry-git.js';

export const pullCommand = new Command('pull')
  .description('Pull skills from the remote registry')
  .option('--skill <name>', 'Pull a specific skill (skip interactive selection)')
  .option('--all', 'Pull all skills (skip interactive selection)')
  .action(async (options: { skill?: string; all?: boolean }) => {
    await pullRegistry({
      ...(options.skill ? { skill: options.skill } : {}),
      ...(options.all ? { all: true } : {}),
    });
  });
