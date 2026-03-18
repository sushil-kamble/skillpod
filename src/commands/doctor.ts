import { Command } from 'commander';

import { runDoctor } from '../core/doctor.js';

export const doctorCommand = new Command('doctor')
  .description('Check skillpod health and configuration')
  .action(async () => {
    await runDoctor();
  });
