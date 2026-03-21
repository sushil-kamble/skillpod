import { Command } from 'commander';

import { createSkill, type AuthoringMode } from '#core/agent-skill/skills/skills.js';

export const createCommand = new Command('create')
  .description('Create a new skill')
  .argument('[name]', 'Skill name')
  .option('--mode <mode>', 'Authoring mode: skip, open-vscode, use-skill-creator')
  .action(async (name: string | undefined, options: { mode?: AuthoringMode }) => {
    await createSkill({
      ...(name ? { name } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
    });
  });
