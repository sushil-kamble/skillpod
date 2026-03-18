import { Command } from 'commander';

import { initializeSkillPod } from '../core/init.js';

export const initCommand = new Command('init')
  .description('Initialize skillpod')
  .action(async () => {
    await initializeSkillPod();
  });
