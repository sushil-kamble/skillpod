import { Command } from 'commander';

import { runDoctor } from '../core/doctor.js';

export const doctorCommand = new Command('doctor')
  .description('Check skill-forge health and configuration')
  .action(async () => {
    await runDoctor();
  });
