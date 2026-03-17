import { Command } from 'commander';

import { syncRegistry } from '../core/registry-git.js';

export const syncCommand = new Command('sync')
  .description('Sync registry changes')
  .action(async () => {
    await syncRegistry();
  });
