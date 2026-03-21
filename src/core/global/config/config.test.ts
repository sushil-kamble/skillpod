import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDirectories = new Set<string>();
const originalHome = process.env.HOME;

afterEach(async () => {
  process.env.HOME = originalHome;

  await Promise.all(
    Array.from(tempDirectories, async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
      tempDirectories.delete(directory);
    }),
  );
});

async function makeTempHome(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skillpod-config-'));
  tempDirectories.add(directory);
  process.env.HOME = directory;
  return directory;
}

async function importConfigModule() {
  return import(`./config.js?test=${Date.now()}-${Math.random()}`);
}

test('loadConfig returns defaults when the config file does not exist', async () => {
  await makeTempHome();
  const { loadConfig } = await importConfigModule();

  const config = await loadConfig();

  assert.deepEqual(config, {
    githubToken: '',
    githubUsername: '',
    registryRepoUrl: '',
    localRegistryPath: null,
    registryRepoName: null,
  });
});

test('saveConfig writes the config file with 600 permissions', async () => {
  const tempHome = await makeTempHome();
  const { getConfigFilePath, saveConfig } = await importConfigModule();

  await saveConfig({
    githubToken: 'secret-token',
    githubUsername: 'octocat',
    registryRepoUrl: 'https://github.com/octocat/skills',
    localRegistryPath: path.join(tempHome, '.skillpod', 'registry'),
    registryRepoName: 'skills',
  });

  const stats = await fs.stat(getConfigFilePath());
  assert.equal(stats.mode & 0o777, 0o600);
});
