import { Command } from 'commander';

import { pushRegistry } from '#core/agent-skill/registry-git/registry-git.js';

export const pushCommand = new Command('push')
  .description('Push local skill changes to the remote registry')
  .option('--skill <name>', 'Push a specific skill (skip interactive selection)')
  .option('--all', 'Push all changes (skip interactive selection)')
  .action(async (options: { skill?: string; all?: boolean }) => {
    await pushRegistry({
      ...(options.skill ? { skill: options.skill } : {}),
      ...(options.all ? { all: true } : {}),
    });
  });
