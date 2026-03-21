import { Command } from 'commander';

import { initializeSkillPod } from '#core/global/init/init.js';

export const initCommand = new Command('init')
  .description('Initialize skillpod')
  .option('--token <token>', 'GitHub personal access token (skip interactive prompt)')
  .option('--repo <url>', 'Repository URL (skip repo setup prompts)')
  .option('-y, --yes', 'Auto-confirm reinitialize prompt')
  .action(async (options: { token?: string; repo?: string; yes?: boolean }) => {
    await initializeSkillPod({
      ...(options.token ? { token: options.token } : {}),
      ...(options.repo ? { repo: options.repo } : {}),
      ...(options.yes ? { yes: true } : {}),
    });
  });
