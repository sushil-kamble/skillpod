import type { Command } from 'commander';

import { createCommand } from '#commands/agent-skill/create.js';
import { doctorCommand } from '#commands/global/doctor.js';
import { editCommand } from '#commands/agent-skill/edit.js';
import { initCommand } from '#commands/global/init.js';
import { installCommand } from '#commands/agent-skill/install.js';
import { listCommand } from '#commands/agent-skill/list.js';
import { pullCommand } from '#commands/agent-skill/pull.js';
import { pushCommand } from '#commands/agent-skill/push.js';
import { removeCommand } from '#commands/agent-skill/remove.js';
import { sendCommand } from '#commands/agent-skill/send.js';
import { unloadCommand } from '#commands/global/unload.js';

export function registerCommands(program: Command): void {
  [
    initCommand,
    doctorCommand,
    createCommand,
    listCommand,
    editCommand,
    removeCommand,
    pushCommand,
    pullCommand,
    sendCommand,
    installCommand,
    unloadCommand,
  ].forEach((command) => {
    program.addCommand(command);
  });
}
