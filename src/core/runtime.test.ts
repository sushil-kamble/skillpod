import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { assertSupportedNodeVersion, commandRequiresInitialization, ensureCommandInitialization } from './runtime.js';
import type { SkillForgeConfig } from '../types/config.js';

function createConfig(overrides: Partial<SkillForgeConfig> = {}): SkillForgeConfig {
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
    assert.throws(
      () => assertSupportedNodeVersion('16.20.0'),
      /requires Node\.js 18 or newer/,
    );
  });

  test('commandRequiresInitialization exempts init and doctor', () => {
    assert.equal(commandRequiresInitialization('init'), false);
    assert.equal(commandRequiresInitialization('doctor'), false);
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
      /skill-forge not initialized/,
    );
  });

  test('ensureCommandInitialization allows init and doctor without config', async () => {
    await assert.doesNotReject(() =>
      ensureCommandInitialization('init', async () =>
        createConfig({
          githubToken: '',
          githubUsername: '',
          registryRepoUrl: '',
          localRegistryPath: null,
          registryRepoName: null,
        }),
      ),
    );
    await assert.doesNotReject(() =>
      ensureCommandInitialization('doctor', async () =>
        createConfig({
          githubToken: '',
          githubUsername: '',
          registryRepoUrl: '',
          localRegistryPath: null,
          registryRepoName: null,
        }),
      ),
    );
  });
});
