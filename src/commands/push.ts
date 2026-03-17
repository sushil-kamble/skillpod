import { Command } from 'commander';

import { pushRegistry } from '../core/registry-git.js';

export const pushCommand = new Command('push')
  .description('Push registry changes')
  .option('-m, --message <message>', 'Custom commit message')
  .action(async (options: { message?: string }) => {
    await pushRegistry(options.message ? { message: options.message } : {});
  });
