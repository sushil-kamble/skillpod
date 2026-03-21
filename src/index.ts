#!/usr/bin/env node

import { assertSupportedNodeVersion } from '#core/global/runtime/runtime.js';
import { createProgram } from './program.js';
import { getErrorMessage } from '#utils/errors/errors.js';
import { logger, setDebugMode } from '#utils/logging/logger.js';
import { BANNER } from '#utils/formatting/ui.js';
import { getPackageVersion } from '#utils/package/version.js';

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

  console.log(BANNER);
  await program.parseAsync(argv);
}

main().catch((error: unknown) => {
  logger.error(getErrorMessage(error));
  process.exitCode = 1;
});
