import { Command } from 'commander';

import { listSkills } from '#core/agent-skill/skills/skills.js';

export const listCommand = new Command('list')
  .description('List available skills')
  .option('--json', 'Output skills as JSON (non-interactive)')
  .action(async (options: { json?: boolean }) => {
    await listSkills(options.json ? { json: true } : {});
  });
