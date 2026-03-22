import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { simpleGit } from 'simple-git';

import {
  pullRegistry,
  pushRegistry,
  registryGitInternals,
  type RegistryPrompts,
} from '#core/agent-skill/registry-git/registry-git.js';
import type { GitHubService, RegistryRepositoryStatus } from '#core/global/github/github.js';
import type { SkillPodConfig } from '#types/config.js';
import {
  createRecordingLogger,
  createSilentSpinnerFactory,
  createTempDirTracker,
} from '#test-utils/shared.js';

afterEach(async () => {
  await tempDirTracker.cleanup();
});

const tempDirTracker = createTempDirTracker();
const { makeTempDir } = tempDirTracker;

async function createRemoteRepository(): Promise<{
  barePath: string;
  seedPath: string;
}> {
  const root = await makeTempDir('skillpod-phase4-');
  const seedPath = path.join(root, 'seed');
  const barePath = path.join(root, 'remote.git');
  await fs.mkdir(seedPath, { recursive: true });

  const seedGit = simpleGit(seedPath);
  await seedGit.init(['--initial-branch=main']);
  await seedGit.addConfig('user.name', 'skillpod-tests', false, 'local');
  await seedGit.addConfig('user.email', 'skillpod-tests@example.com', false, 'local');
  await fs.writeFile(path.join(seedPath, 'README.md'), '# skills\n', 'utf8');
  await seedGit.add('README.md');
  await seedGit.commit('chore: initialize repository');
  await seedGit.clone('.', barePath, ['--bare']);

  return { barePath, seedPath };
}

async function cloneWorkingRepository(remotePath: string, cloneName: string): Promise<string> {
  const root = await makeTempDir(`skillpod-clone-${cloneName}-`);
  const localPath = path.join(root, cloneName);
  await simpleGit().clone(remotePath, localPath);

  const git = simpleGit(localPath);
  await git.addConfig('user.name', 'skillpod-tests', false, 'local');
  await git.addConfig('user.email', 'skillpod-tests@example.com', false, 'local');

  return localPath;
}

async function createConfig(
  localRegistryPath: string,
  repoUrl = 'https://github.com/octocat/skills',
): Promise<SkillPodConfig> {
  return {
    githubToken: 'token',
    githubUsername: 'octocat',
    registryRepoUrl: repoUrl,
    localRegistryPath,
    registryRepoName: 'skills',
  };
}

function createPromptStub(searchValues: string[]): RegistryPrompts {
  const queue = [...searchValues];

  return {
    async search<T extends string>(_message: string, choices: Array<{ value: T }>): Promise<T> {
      const nextValue = queue.shift();

      if (nextValue === undefined) {
        throw new Error('No search response configured.');
      }

      if (!choices.some((c) => c.value === nextValue)) {
        throw new Error(`Search choice "${nextValue}" is not valid.`);
      }

      return nextValue as T;
    },
  };
}

function createGitHubStub(remoteSkills: string[] = []): GitHubService {
  return {
    async validateToken() {
      throw new Error('Not used in registry-git tests.');
    },
    async createSkillsRepository() {
      throw new Error('Not used in registry-git tests.');
    },
    async getRepository() {
      throw new Error('Not used in registry-git tests.');
    },
    resolveRepositoryFromUrl() {
      throw new Error('Not used in registry-git tests.');
    },
    async getRepositoryStatus(): Promise<RegistryRepositoryStatus> {
      throw new Error('Not used in registry-git tests.');
    },
    async listRemoteSkills() {
      return remoteSkills;
    },
  };
}

async function writeSkill(
  localRegistryPath: string,
  name: string,
  content?: string,
): Promise<void> {
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

describe('push registry', () => {
  test('pushRegistry pushes a selected skill to the remote repository', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'fastapi-structure');

    const result = await pushRegistry(
      {},
      {
        prompts: createPromptStub(['fastapi-structure']),
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.status, 'pushed');
    assert.equal(result.pushedSkill, 'fastapi-structure');

    const verificationClone = await cloneWorkingRepository(barePath, 'verify-push');
    await assert.doesNotReject(() =>
      fs.access(path.join(verificationClone, 'skills', 'fastapi-structure', 'SKILL.md')),
    );
  });

  test('pushRegistry pushes all skills when user selects push all', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-all');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'skill-a');
    await writeSkill(localPath, 'skill-b');

    const result = await pushRegistry(
      {},
      {
        prompts: createPromptStub(['__all__']),
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.status, 'pushed');
    assert.equal(result.pushedSkill, undefined);

    const verificationClone = await cloneWorkingRepository(barePath, 'verify-all');
    await assert.doesNotReject(() =>
      fs.access(path.join(verificationClone, 'skills', 'skill-a', 'SKILL.md')),
    );
    await assert.doesNotReject(() =>
      fs.access(path.join(verificationClone, 'skills', 'skill-b', 'SKILL.md')),
    );
  });

  test('pushRegistry cancels when user selects cancel', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-cancel');
    const logs: string[] = [];
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'fastapi-structure');

    const result = await pushRegistry(
      {},
      {
        prompts: createPromptStub(['__cancel__']),
        logger: createRecordingLogger(logs),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.status, 'cancelled');
    assert.match(logs.join('\n'), /Push cancelled/);
  });

  test('pushRegistry reports already synced when selected skill has no changes', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-synced');
    const logs: string[] = [];
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'fastapi-structure');

    const localGit = simpleGit(localPath);
    await localGit.add(['-A']);
    await localGit.commit('feat: add skill');
    await localGit.push('origin', 'main');

    const result = await pushRegistry(
      {},
      {
        prompts: createPromptStub(['fastapi-structure']),
        logger: createRecordingLogger(logs),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.status, 'up_to_date');
    assert.match(logs.join('\n'), /already synced/);
  });

  test('pushRegistry uses a default commit message based on skill name', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-message');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'fastapi-structure');

    const result = await pushRegistry(
      {},
      {
        prompts: createPromptStub(['fastapi-structure']),
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.commitMessage, 'chore: push skill "fastapi-structure"');
    const git = simpleGit(localPath);
    const log = await git.log();
    assert.equal(log.latest?.message, 'chore: push skill "fastapi-structure"');
  });

  test('pushRegistry guards against non-git registries', async () => {
    const localPath = await makeTempDir('skillpod-non-git-');

    await assert.rejects(
      () =>
        pushRegistry(
          {},
          {
            prompts: createPromptStub(['__all__']),
            logger: createRecordingLogger(),
            loadConfig: async () => createConfig(localPath),
          },
        ),
      /not a git repository/,
    );
  });

  test('pushRegistry shows empty state when no local skills exist', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-empty');
    const logs: string[] = [];

    const result = await pushRegistry(
      {},
      {
        prompts: createPromptStub([]),
        logger: createRecordingLogger(logs),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.status, 'up_to_date');
    assert.match(logs.join('\n'), /No local skills found/);
  });

  test('pushRegistry pushes a named skill via --skill flag without prompting', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-skill-flag');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'my-skill');

    let searchCalled = false;
    const result = await pushRegistry(
      { skill: 'my-skill' },
      {
        prompts: {
          async search() {
            searchCalled = true;
            return '' as never;
          },
        },
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.status, 'pushed');
    assert.equal(result.pushedSkill, 'my-skill');
    assert.equal(searchCalled, false);
  });

  test('pushRegistry pushes all via --all flag without prompting', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-all-flag');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'skill-x');
    await writeSkill(localPath, 'skill-y');

    let searchCalled = false;
    const result = await pushRegistry(
      { all: true },
      {
        prompts: {
          async search() {
            searchCalled = true;
            return '' as never;
          },
        },
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.status, 'pushed');
    assert.equal(result.pushedSkill, undefined);
    assert.equal(searchCalled, false);
  });

  test('pushRegistry pushes tracked deletions when the last local skill was removed', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-delete-last');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'delete-me');

    const localGit = simpleGit(localPath);
    await localGit.add(['-A']);
    await localGit.commit('feat: add delete target');
    await localGit.push('origin', 'main');

    await fs.rm(path.join(localPath, 'skills', 'delete-me'), { recursive: true, force: true });

    const result = await pushRegistry(
      { all: true },
      {
        prompts: createPromptStub([]),
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.status, 'pushed');

    const verificationClone = await cloneWorkingRepository(barePath, 'verify-delete-last');
    await assert.rejects(() =>
      fs.access(path.join(verificationClone, 'skills', 'delete-me', 'SKILL.md')),
    );
  });

  test('pushRegistry pushes a deleted tracked skill via --skill flag', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-delete-skill-flag');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'keep-me');
    await writeSkill(localPath, 'delete-me');

    const localGit = simpleGit(localPath);
    await localGit.add(['-A']);
    await localGit.commit('feat: add skills');
    await localGit.push('origin', 'main');

    await fs.rm(path.join(localPath, 'skills', 'delete-me'), { recursive: true, force: true });

    let searchCalled = false;
    const result = await pushRegistry(
      { skill: 'delete-me' },
      {
        prompts: {
          async search() {
            searchCalled = true;
            return '' as never;
          },
        },
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
      },
    );

    assert.equal(result.status, 'pushed');
    assert.equal(result.pushedSkill, 'delete-me');
    assert.equal(searchCalled, false);

    const verificationClone = await cloneWorkingRepository(barePath, 'verify-delete-skill-flag');
    await assert.rejects(() =>
      fs.access(path.join(verificationClone, 'skills', 'delete-me', 'SKILL.md')),
    );
    await assert.doesNotReject(() =>
      fs.access(path.join(verificationClone, 'skills', 'keep-me', 'SKILL.md')),
    );
  });

  test('pushRegistry rejects --skill when skill does not exist', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-missing-skill');
    await fs.mkdir(path.join(localPath, 'skills'), { recursive: true });
    await writeSkill(localPath, 'real-skill');

    await assert.rejects(
      () =>
        pushRegistry(
          { skill: 'nonexistent' },
          {
            prompts: createPromptStub([]),
            logger: createRecordingLogger(),
            loadConfig: async () => createConfig(localPath),
            spinner: createSilentSpinnerFactory(),
          },
        ),
      /Skill "nonexistent" not found in local registry/,
    );
  });
});

describe('pull registry', () => {
  test('pullRegistry pulls remote changes into the local registry', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-pull');
    const remoteWorkerPath = await cloneWorkingRepository(barePath, 'remote-worker');
    await fs.mkdir(path.join(remoteWorkerPath, 'skills'), { recursive: true });
    await writeSkill(remoteWorkerPath, 'fastapi-structure');

    const remoteGit = simpleGit(remoteWorkerPath);
    await remoteGit.add(['-A']);
    await remoteGit.commit('feat: add fastapi structure');
    await remoteGit.push('origin', 'main');

    const result = await pullRegistry(
      {},
      {
        prompts: createPromptStub(['fastapi-structure']),
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
        github: createGitHubStub(['fastapi-structure']),
      },
    );

    assert.equal(result.status, 'pulled');
    await assert.doesNotReject(() =>
      fs.access(path.join(localPath, 'skills', 'fastapi-structure', 'SKILL.md')),
    );
  });

  test('pullRegistry cancels when user selects cancel', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-pull-cancel');
    const logs: string[] = [];

    const result = await pullRegistry(
      {},
      {
        prompts: createPromptStub(['__cancel__']),
        logger: createRecordingLogger(logs),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
        github: createGitHubStub(['some-skill']),
      },
    );

    assert.equal(result.status, 'cancelled');
    assert.match(logs.join('\n'), /Pull cancelled/);
  });

  test('pullRegistry shows empty state when no remote skills exist', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-pull-empty');
    const logs: string[] = [];

    const result = await pullRegistry(
      {},
      {
        prompts: createPromptStub([]),
        logger: createRecordingLogger(logs),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
        github: createGitHubStub([]),
      },
    );

    assert.equal(result.status, 'up_to_date');
    assert.match(logs.join('\n'), /No remote skills found/);
  });

  test('pullRegistry reports up to date when no new changes exist', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-pull-utd');
    const logs: string[] = [];

    const result = await pullRegistry(
      {},
      {
        prompts: createPromptStub(['__all__']),
        logger: createRecordingLogger(logs),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
        github: createGitHubStub(['some-skill']),
      },
    );

    assert.equal(result.status, 'up_to_date');
    assert.match(logs.join('\n'), /up to date/i);
  });

  test('pullRegistry reports merge conflicts with file paths', async () => {
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
        pullRegistry(
          {},
          {
            prompts: createPromptStub(['__all__']),
            logger: createRecordingLogger(),
            loadConfig: async () => createConfig(localPath),
            spinner: createSilentSpinnerFactory(),
            github: createGitHubStub(['fastapi-structure']),
          },
        ),
      /skills\/fastapi-structure\/SKILL\.md/,
    );
  });

  test('pullRegistry pulls a named skill via --skill flag without prompting', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-pull-skill');
    const remoteWorkerPath = await cloneWorkingRepository(barePath, 'remote-pull-skill');
    await fs.mkdir(path.join(remoteWorkerPath, 'skills'), { recursive: true });
    await writeSkill(remoteWorkerPath, 'target-skill');

    const remoteGit = simpleGit(remoteWorkerPath);
    await remoteGit.add(['-A']);
    await remoteGit.commit('feat: add target skill');
    await remoteGit.push('origin', 'main');

    let searchCalled = false;
    const result = await pullRegistry(
      { skill: 'target-skill' },
      {
        prompts: {
          async search() {
            searchCalled = true;
            return '' as never;
          },
        },
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
        github: createGitHubStub(['target-skill']),
      },
    );

    assert.equal(result.status, 'pulled');
    assert.equal(result.pulledSkill, 'target-skill');
    assert.equal(searchCalled, false);
  });

  test('pullRegistry pulls all via --all flag without prompting', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-pull-all');
    const remoteWorkerPath = await cloneWorkingRepository(barePath, 'remote-pull-all');
    await fs.mkdir(path.join(remoteWorkerPath, 'skills'), { recursive: true });
    await writeSkill(remoteWorkerPath, 'skill-one');

    const remoteGit = simpleGit(remoteWorkerPath);
    await remoteGit.add(['-A']);
    await remoteGit.commit('feat: add skill');
    await remoteGit.push('origin', 'main');

    let searchCalled = false;
    const result = await pullRegistry(
      { all: true },
      {
        prompts: {
          async search() {
            searchCalled = true;
            return '' as never;
          },
        },
        logger: createRecordingLogger(),
        loadConfig: async () => createConfig(localPath),
        spinner: createSilentSpinnerFactory(),
        github: createGitHubStub(['skill-one']),
      },
    );

    assert.equal(result.status, 'pulled');
    assert.equal(result.pulledSkill, undefined);
    assert.equal(searchCalled, false);
  });

  test('pullRegistry rejects --skill when skill does not exist remotely', async () => {
    const { barePath } = await createRemoteRepository();
    const localPath = await cloneWorkingRepository(barePath, 'local-pull-missing');

    await assert.rejects(
      () =>
        pullRegistry(
          { skill: 'nonexistent' },
          {
            prompts: createPromptStub([]),
            logger: createRecordingLogger(),
            loadConfig: async () => createConfig(localPath),
            spinner: createSilentSpinnerFactory(),
            github: createGitHubStub(['real-skill']),
          },
        ),
      /Skill "nonexistent" not found in remote registry/,
    );
  });
});

describe('summary parsers', () => {
  test('parseStatusSummary groups skill changes predictably', () => {
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
