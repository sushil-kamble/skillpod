import { Command } from 'commander';

import { removeSkill } from '../core/skills.js';

export const removeCommand = new Command('remove')
  .description('Remove an existing skill')
  .argument('[name]', 'Skill name (optional — lists skills if omitted)')
  .action(async (name?: string) => {
    await removeSkill(name ? { name } : {});
  });
