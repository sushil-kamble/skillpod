import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSupportedNodeVersion,
  commandRequiresInitialization,
  ensureCommandInitialization,
} from '#core/global/runtime/runtime.js';
import type { SkillPodConfig } from '#types/config.js';

function createConfig(overrides: Partial<SkillPodConfig> = {}): SkillPodConfig {
  return {
    githubToken: 'token',
    githubUsername: 'octocat',
    registryRepoUrl: 'https://github.com/octocat/skills',
    localRegistryPath: '/tmp/registry',
    registryRepoName: 'skills',
    ...overrides,
  };
}

describe('runtime guards', () => {
  test('assertSupportedNodeVersion rejects unsupported Node.js versions', () => {
    assert.throws(() => assertSupportedNodeVersion('18.20.0'), /requires Node\.js 20 or newer/);
  });

  test('commandRequiresInitialization exempts init, doctor, and unload', () => {
    assert.equal(commandRequiresInitialization('init'), false);
    assert.equal(commandRequiresInitialization('doctor'), false);
    assert.equal(commandRequiresInitialization('unload'), false);
    assert.equal(commandRequiresInitialization('list'), true);
  });

  test('ensureCommandInitialization blocks commands when config is partial', async () => {
    await assert.rejects(
      () =>
        ensureCommandInitialization('list', async () =>
          createConfig({
            githubToken: '',
            githubUsername: '',
            registryRepoUrl: '',
            localRegistryPath: null,
            registryRepoName: null,
          }),
        ),
      /skillpod not initialized/,
    );
  });

  test('ensureCommandInitialization allows commands when token is empty but setup is complete', async () => {
    await assert.doesNotReject(() =>
      ensureCommandInitialization('list', async () =>
        createConfig({
          githubToken: '',
          githubUsername: '',
        }),
      ),
    );
  });

  test('ensureCommandInitialization allows init, doctor, and unload without config', async () => {
    const emptyConfig = {
      githubToken: '',
      githubUsername: '',
      registryRepoUrl: '',
      localRegistryPath: null as string | null,
      registryRepoName: null as string | null,
    };

    await assert.doesNotReject(() =>
      ensureCommandInitialization('init', async () => createConfig(emptyConfig)),
    );
    await assert.doesNotReject(() =>
      ensureCommandInitialization('doctor', async () => createConfig(emptyConfig)),
    );
    await assert.doesNotReject(() =>
      ensureCommandInitialization('unload', async () => createConfig(emptyConfig)),
    );
  });
});
