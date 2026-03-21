import { Command } from 'commander';

import { unloadSkillPod } from '#core/global/unload/unload.js';

export const unloadCommand = new Command('unload')
  .description('Remove skillpod configuration, local registry, and stored credentials')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (options: { yes?: boolean }) => {
    await unloadSkillPod(options.yes ? { yes: true } : {});
  });
