import { Command } from 'commander';

import { pullRegistry } from '../core/registry-git.js';

export const pullCommand = new Command('pull')
  .description('Pull skills from the remote registry')
  .action(async () => {
    await pullRegistry();
  });
