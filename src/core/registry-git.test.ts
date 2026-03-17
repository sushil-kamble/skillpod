import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { simpleGit } from 'simple-git';

import {
  pushRegistry,
  registryGitInternals,
  syncRegistry,
  type RegistryPrompts,
} from './registry-git.js';
import type { SkillForgeConfig } from '../types/config.js';
import { createRecordingLogger, createTempDirTracker } from '../test-utils/shared.js';

afterEach(async () => {
  await tempDirTracker.cleanup();
});

const tempDirTracker = createTempDirTracker();
const { makeTempDir } = tempDirTracker;

async function createRemoteRepository(): Promise<{
  barePath: string;
  seedPath: string;
}> {
  const root = await makeTempDir('skill-forge-phase4-');
  const seedPath = path.join(root, 'seed');
  const barePath = path.join(root, 'remote.git');
  await fs.mkdir(seedPath, { recursive: true });

  const seedGit = simpleGit(seedPath);
  await seedGit.init(['--initial-branch=main']);
  await seedGit.addConfig('user.name', 'skill-forge-tests', false, 'local');
  await seedGit.addConfig('user.email', 'skill-forge-tests@example.com', false, 'local');
  await fs.writeFile(path.join(seedPath, 'README.md'), '# skills\n', 'utf8');
  await seedGit.add('README.md');
  await seedGit.commit('chore: initialize repository');
  await seedGit.clone('.', barePath, ['--bare']);

  return { barePath, seedPath };
}

async function cloneWorkingRepository(remotePath: string, cloneName: string): Promise<string> {
  const root = await makeTempDir(`skill-forge-clone-${cloneName}-`);
  const localPath = path.join(root, cloneName);
  await simpleGit().clone(remotePath, localPath);

  const git = simpleGit(localPath);
  await git.addConfig('user.name', 'skill-forge-tests', false, 'local');
  await git.addConfig('user.email', 'skill-forge-tests@example.com', false, 'local');

  return localPath;
}

async function createConfig(localRegistryPath: string, repoUrl = 'https://github.com/octocat/skills'): Promise<SkillForgeConfig> {
  return {
    githubToken: 'token',
    githubUsername: 'octocat',
    registryRepoUrl: repoUrl,
    localRegistryPath,
    registryRepoName: 'skills',
  };
}

function createPromptStub(confirmValues: boolean[]): RegistryPrompts {
  return {
    async confirm(): Promise<boolean> {
      const nextValue = confirmValues.shift();

      if (nextValue === undefined) {
        throw new Error('No confirmation response configured.');
      }

      return nextValue;
    },
  };
}

async function writeSkill(localRegistryPath: string, name: string, content?: string): Promise<void> {
  const skillDirectory = path.join(localRegistryPath, 'skills', name);
  await fs.mkdir(skillDirectory, { recursive: true });
  await fs.writeFile(
    path.join(skillDirectory, 'SKILL.md'),
    content ??
      `---
name: ${name}
description:
  Test skill
---

# ${name}
`,
    'utf8',
  );
}

describe('registry git workflows', () => {
  test('pushRegistry pushes a created skill to the remote repository', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'fastapi-structure');

    const result = await pushRegistry(
      {},
      {
        prompts: createPromptStub([true]),
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
      },
    );

    assert.equal(result.status, 'pushed');

    const verificationClone = await cloneWorkingRepository(barePath, 'verify-push');
    await assert.doesNotReject(() => fs.access(path.join(verificationClone, 'skills', 'fastapi-structure', 'SKILL.md')));
  });

  test('pushRegistry reports up to date when there are no local changes', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-up-to-date');
    const logs: string[] = [];

    const result = await pushRegistry({
    }, {
      prompts: createPromptStub([true]),
      logger: createRecordingLogger(logs),
      loadConfig: async () => createConfig(localPath),
    });

    assert.equal(result.status, 'up_to_date');
    assert.match(logs.join('\n'), /Registry is up to date/);
  });

  test('pushRegistry uses a custom commit message', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-message');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'fastapi-structure');

    const result = await pushRegistry(
      { message: 'my custom message' },
      {
        prompts: createPromptStub([true]),
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
      },
    );

    assert.equal(result.commitMessage, 'my custom message');
    const git = simpleGit(localPath);
    const log = await git.log();
    assert.equal(log.latest?.message, 'my custom message');
  });

  test('syncRegistry pulls remote changes into the local registry', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-sync');
    const remoteWorkerPath = await cloneWorkingRepository(barePath, 'remote-worker');
    await fs.mkdir(path.join(remoteWorkerPath, 'skills'), { recursive: true });
    await writeSkill(remoteWorkerPath, 'fastapi-structure');

    const remoteGit = simpleGit(remoteWorkerPath);
    await remoteGit.add(['-A']);
    await remoteGit.commit('feat: add fastapi structure');
    await remoteGit.push('origin', 'main');

    const result = await syncRegistry({
      logger: createRecordingLogger(),
      loadConfig: async () => createConfig(localPath),
    });

    assert.equal(result.status, 'synced');
    await assert.doesNotReject(() => fs.access(path.join(localPath, 'skills', 'fastapi-structure', 'SKILL.md')));
    assert.deepEqual(result.summary.added, ['fastapi-structure']);
  });

  test('syncRegistry reports merge conflicts with exact file paths', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-conflict');
    const remoteWorkerPath = await cloneWorkingRepository(barePath, 'remote-conflict');

    await fs.mkdir(path.join(localPath, 'skills', 'fastapi-structure'), { recursive: true });
    await fs.writeFile(
      path.join(localPath, 'skills', 'fastapi-structure', 'SKILL.md'),
      `---
name: fastapi-structure
description: Local version
---
`,
      'utf8',
    );
    const localGit = simpleGit(localPath);
    await localGit.add(['-A']);
    await localGit.commit('feat: local version');
    await localGit.push('origin', 'main');

    await localGit.pull('origin', 'main');
    await fs.writeFile(
      path.join(localPath, 'skills', 'fastapi-structure', 'SKILL.md'),
      `---
name: fastapi-structure
description: Local conflicting change
---
`,
      'utf8',
    );
    await localGit.add(['-A']);
    await localGit.commit('feat: local conflicting change');

    const remoteGit = simpleGit(remoteWorkerPath);
    await remoteGit.pull('origin', 'main');
    await fs.writeFile(
      path.join(remoteWorkerPath, 'skills', 'fastapi-structure', 'SKILL.md'),
      `---
name: fastapi-structure
description: Remote conflicting change
---
`,
      'utf8',
    );
    await remoteGit.add(['-A']);
    await remoteGit.commit('feat: remote conflicting change');
    await remoteGit.push('origin', 'main');

    await assert.rejects(
      () =>
        syncRegistry({
          logger: createRecordingLogger(),
          loadConfig: async () => createConfig(localPath),
        }),
      /skills\/fastapi-structure\/SKILL\.md/,
    );
  });

  test('pushRegistry and syncRegistry guard against non-git registries', async () => {
    const localPath = await makeTempDir('skill-forge-non-git-');

    await assert.rejects(
      () =>
        pushRegistry({}, {
          prompts: createPromptStub([true]),
          logger: createRecordingLogger(),
          loadConfig: async () => createConfig(localPath),
        }),
      /not a git repository/,
    );

    await assert.rejects(
      () =>
        syncRegistry({
          logger: createRecordingLogger(),
          loadConfig: async () => createConfig(localPath),
        }),
      /not a git repository/,
    );
  });

  test('pushRegistry blocks when the remote is ahead of local', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-behind');
    const remoteWorkerPath = await cloneWorkingRepository(barePath, 'remote-behind');
    await fs.mkdir(path.join(remoteWorkerPath, 'skills'), { recursive: true });
    await writeSkill(remoteWorkerPath, 'remote-only');

    const remoteGit = simpleGit(remoteWorkerPath);
    await remoteGit.add(['-A']);
    await remoteGit.commit('feat: remote only skill');
    await remoteGit.push('origin', 'main');

    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'local-change');

    await assert.rejects(
      () =>
        pushRegistry({}, {
          prompts: createPromptStub([true]),
          logger: createRecordingLogger(),
          loadConfig: async () => createConfig(localPath),
        }),
      /Run "skill-forge sync" first/,
    );
  });

  test('summary parsers group skill changes predictably', () => {
    const porcelain =
      '?? skills/new-skill/SKILL.md\n M skills/existing-skill/SKILL.md\nD  skills/old-skill/SKILL.md\n';
    const summary = registryGitInternals.parseStatusSummary(porcelain);

    assert.deepEqual(summary, {
      added: ['new-skill'],
      modified: ['existing-skill'],
      removed: ['old-skill'],
    });
  });
});
