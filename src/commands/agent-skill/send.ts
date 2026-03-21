import { Command } from 'commander';

import { sendSkill } from '#core/agent-skill/send/send.js';

export const sendCommand = new Command('send')
  .description('Send a local skill directory to the remote registry')
  .argument('<path>', 'Path to the local skill directory containing SKILL.md')
  .option('--force', 'Overwrite if skill already exists in the registry')
  .action(async (skillPath: string, options: { force?: boolean }) => {
    await sendSkill({
      path: skillPath,
      ...(options.force ? { force: true } : {}),
    });
  });
