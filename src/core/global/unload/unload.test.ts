import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { unloadSkillPod } from '#core/global/unload/unload.js';
import type { SkillPodConfig } from '#types/config.js';
import { createSilentLogger, createTempDirTracker } from '#test-utils/shared.js';

afterEach(async () => {
  await tempDirTracker.cleanup();
});

const tempDirTracker = createTempDirTracker();
const { makeTempDir } = tempDirTracker;

function createConfig(overrides: Partial<SkillPodConfig> = {}): SkillPodConfig {
  return {
    githubToken: '',
    githubUsername: '',
    registryRepoUrl: '',
    localRegistryPath: null,
    registryRepoName: null,
    ...overrides,
  };
}

function createPromptStub(confirmResponse: boolean) {
  return {
    async confirm(): Promise<boolean> {
      return confirmResponse;
    },
  };
}

describe('unloadSkillPod', () => {
  test('removes config directory and local registry when confirmed', async () => {
    const sandbox = await makeTempDir('skillpod-unload-');
    const configDir = path.join(sandbox, '.skillpod');
    const registryDir = path.join(sandbox, 'registry');

    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.json'), '{}', 'utf8');
    await fs.mkdir(path.join(registryDir, 'skills'), { recursive: true });
    await fs.writeFile(path.join(registryDir, 'skills', '.gitkeep'), '', 'utf8');

    const result = await unloadSkillPod(
      {},
      {
        prompts: createPromptStub(true),
        logger: createSilentLogger(),
        loadConfig: async () =>
          createConfig({
            githubToken: 'secret-token',
            githubUsername: 'octocat',
            registryRepoUrl: 'https://github.com/octocat/skills',
            localRegistryPath: registryDir,
            registryRepoName: 'skills',
          }),
        getConfigDirPath: () => configDir,
      },
    );

    assert.equal(result.status, 'completed');
    assert.equal(result.removedConfigDir, true);
    assert.equal(result.removedLocalRegistry, true);

    const configExists = await fs
      .access(configDir)
      .then(() => true)
      .catch(() => false);
    const registryExists = await fs
      .access(registryDir)
      .then(() => true)
      .catch(() => false);

    assert.equal(configExists, false);
    assert.equal(registryExists, false);
  });

  test('cancels when user declines confirmation', async () => {
    const sandbox = await makeTempDir('skillpod-unload-cancel-');
    const configDir = path.join(sandbox, '.skillpod');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.json'), '{}', 'utf8');

    const result = await unloadSkillPod(
      {},
      {
        prompts: createPromptStub(false),
        logger: createSilentLogger(),
        loadConfig: async () => createConfig(),
        getConfigDirPath: () => configDir,
      },
    );

    assert.equal(result.status, 'cancelled');
    assert.equal(result.removedConfigDir, false);
    assert.equal(result.removedLocalRegistry, false);

    const configExists = await fs
      .access(configDir)
      .then(() => true)
      .catch(() => false);
    assert.equal(configExists, true);
  });

  test('returns nothing_to_unload when no config or registry exists', async () => {
    const sandbox = await makeTempDir('skillpod-unload-empty-');
    const configDir = path.join(sandbox, '.skillpod');

    const result = await unloadSkillPod(
      {},
      {
        prompts: createPromptStub(true),
        logger: createSilentLogger(),
        loadConfig: async () => createConfig(),
        getConfigDirPath: () => configDir,
      },
    );

    assert.equal(result.status, 'nothing_to_unload');
    assert.equal(result.removedConfigDir, false);
    assert.equal(result.removedLocalRegistry, false);
  });

  test('removes only config directory when no local registry is configured', async () => {
    const sandbox = await makeTempDir('skillpod-unload-noregistry-');
    const configDir = path.join(sandbox, '.skillpod');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.json'), '{}', 'utf8');

    const result = await unloadSkillPod(
      {},
      {
        prompts: createPromptStub(true),
        logger: createSilentLogger(),
        loadConfig: async () =>
          createConfig({
            githubToken: 'token',
            githubUsername: 'octocat',
          }),
        getConfigDirPath: () => configDir,
      },
    );

    assert.equal(result.status, 'completed');
    assert.equal(result.removedConfigDir, true);
    assert.equal(result.removedLocalRegistry, false);
  });

  test('removes only local registry when config directory is already missing', async () => {
    const sandbox = await makeTempDir('skillpod-unload-noconfig-');
    const configDir = path.join(sandbox, '.skillpod');
    const registryDir = path.join(sandbox, 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    const result = await unloadSkillPod(
      {},
      {
        prompts: createPromptStub(true),
        logger: createSilentLogger(),
        loadConfig: async () =>
          createConfig({
            localRegistryPath: registryDir,
          }),
        getConfigDirPath: () => configDir,
      },
    );

    assert.equal(result.status, 'completed');
    assert.equal(result.removedConfigDir, false);
    assert.equal(result.removedLocalRegistry, true);

    const registryExists = await fs
      .access(registryDir)
      .then(() => true)
      .catch(() => false);
    assert.equal(registryExists, false);
  });

  test('skips confirmation with --yes flag', async () => {
    const sandbox = await makeTempDir('skillpod-unload-yes-');
    const configDir = path.join(sandbox, '.skillpod');
    const registryDir = path.join(sandbox, 'registry');

    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.json'), '{}', 'utf8');
    await fs.mkdir(path.join(registryDir, 'skills'), { recursive: true });

    let confirmCalled = false;
    const result = await unloadSkillPod(
      { yes: true },
      {
        prompts: {
          async confirm(): Promise<boolean> {
            confirmCalled = true;
            return false;
          },
        },
        logger: createSilentLogger(),
        loadConfig: async () =>
          createConfig({
            githubToken: 'secret-token',
            githubUsername: 'octocat',
            registryRepoUrl: 'https://github.com/octocat/skills',
            localRegistryPath: registryDir,
            registryRepoName: 'skills',
          }),
        getConfigDirPath: () => configDir,
      },
    );

    assert.equal(result.status, 'completed');
    assert.equal(confirmCalled, false);
    assert.equal(result.removedConfigDir, true);
    assert.equal(result.removedLocalRegistry, true);
  });

  test('handles local registry path that no longer exists on disk', async () => {
    const sandbox = await makeTempDir('skillpod-unload-gone-');
    const configDir = path.join(sandbox, '.skillpod');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.json'), '{}', 'utf8');

    const result = await unloadSkillPod(
      {},
      {
        prompts: createPromptStub(true),
        logger: createSilentLogger(),
        loadConfig: async () =>
          createConfig({
            githubToken: 'token',
            localRegistryPath: path.join(sandbox, 'nonexistent-registry'),
          }),
        getConfigDirPath: () => configDir,
      },
    );

    assert.equal(result.status, 'completed');
    assert.equal(result.removedConfigDir, true);
    assert.equal(result.removedLocalRegistry, false);
  });
});
