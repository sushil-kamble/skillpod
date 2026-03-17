#!/usr/bin/env node

import { assertSupportedNodeVersion } from './core/runtime.js';
import { createProgram } from './program.js';
import { getErrorMessage } from './utils/errors.js';
import { logger, setDebugMode } from './utils/logger.js';
import { getPackageVersion } from './utils/version.js';

async function main(argv = process.argv): Promise<void> {
  assertSupportedNodeVersion();

  const version = await getPackageVersion();
  const program = createProgram({
    logger,
    setDebugMode,
    version,
  });

  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv);
}

main().catch((error: unknown) => {
  logger.error(getErrorMessage(error));
  process.exitCode = 1;
});
