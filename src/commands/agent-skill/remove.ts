import { Command } from 'commander';

import { removeSkill } from '#core/agent-skill/skills/skills.js';

export const removeCommand = new Command('remove')
  .description('Remove an existing skill')
  .argument('[name]', 'Skill name (optional — lists skills if omitted)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--push', 'Push removal to remote without prompting')
  .action(async (name: string | undefined, options: { yes?: boolean; push?: boolean }) => {
    await removeSkill({
      ...(name ? { name } : {}),
      ...(options.yes ? { yes: true } : {}),
      ...(options.push ? { push: true } : {}),
    });
  });
