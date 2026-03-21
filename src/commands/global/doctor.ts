import { Command } from 'commander';

import { runDoctor } from '#core/global/doctor/doctor.js';

export const doctorCommand = new Command('doctor')
  .description('Check skillpod health and configuration')
  .action(async () => {
    await runDoctor();
  });
