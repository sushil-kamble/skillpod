import { Command } from 'commander';

import { installSkills } from '#core/agent-skill/install/install.js';

export const installCommand = new Command('install')
  .description('Install skills into an agent (extra flags are forwarded to skills.sh)')
  .argument('[name]', 'Skill name (optional — shows interactive selection if omitted)')
  .passThroughOptions()
  .allowUnknownOption()
  .action(async (name: string | undefined, _opts: unknown, command: Command) => {
    const passthrough = command.args.slice(name ? 1 : 0);
    await installSkills({
      ...(name ? { skill: name } : {}),
      ...(passthrough.length > 0 ? { passthrough } : {}),
    });
  });
