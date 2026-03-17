import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgram } from './program.js';

test('createProgram uses the invoked subcommand name for initialization gating', async () => {
  const seenCommandNames: string[] = [];
  const program = createProgram({
    ensureCommandInitialization: async (commandName) => {
      seenCommandNames.push(commandName);
    },
    loadConfig: async () => ({
      githubToken: '',
      githubUsername: '',
      localRegistryPath: '',
      registryRepoName: 'skills',
      registryRepoUrl: '',
    }),
    logger: {
      debug: () => {},
    },
    registerCommands: (rootProgram) => {
      rootProgram.command('doctor').action(() => {});
    },
    setDebugMode: () => {},
    version: '0.1.0',
  });

  await program.parseAsync(['doctor'], { from: 'user' });

  assert.deepEqual(seenCommandNames, ['doctor']);
});
