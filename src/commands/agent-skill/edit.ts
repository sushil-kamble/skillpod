import { Command } from 'commander';

import { editSkill, type AuthoringMode } from '#core/agent-skill/skills/skills.js';

export const editCommand = new Command('edit')
  .description('Edit an existing skill')
  .argument('[name]', 'Skill name')
  .option('--mode <mode>', 'Authoring mode: skip, open-vscode, use-skill-creator')
  .action(async (name: string | undefined, options: { mode?: AuthoringMode }) => {
    await editSkill({
      ...(name ? { name } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
    });
  });
