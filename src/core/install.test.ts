import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { installInternals, installSkills } from './install.js';
import type { GitHubService, RegistryRepositoryStatus } from './github.js';
import type { InstallPrompts } from './install.js';
import type { SkillPodConfig } from '../types/config.js';
import { createRecordingLogger } from '../test-utils/shared.js';

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

function createRepositoryStatus(
  overrides: Partial<RegistryRepositoryStatus> = {},
): RegistryRepositoryStatus {
  return {
    hasSkillsDirectory: true,
    isPrivate: false,
    repository: {
      cloneUrl: 'https://github.com/octocat/skills.git',
      htmlUrl: 'https://github.com/octocat/skills',
      owner: 'octocat',
      repo: 'skills',
    },
    ...overrides,
  };
}

function createGitHubStub(
  status: RegistryRepositoryStatus,
  remoteSkills: string[] = [],
): GitHubService {
  return {
    async validateToken() {
      throw new Error('validateToken should not be called in install tests.');
    },
    async createSkillsRepository() {
      throw new Error('createSkillsRepository should not be called in install tests.');
    },
    async getRepository() {
      throw new Error('getRepository should not be called in install tests.');
    },
    resolveRepositoryFromUrl(repoUrl: string) {
      const url = new URL(repoUrl);
      const segments = url.pathname.split('/').filter(Boolean);
      return {
        cloneUrl: `${repoUrl}.git`,
        htmlUrl: repoUrl,
        owner: segments[0] ?? '',
        repo: segments[1] ?? '',
      };
    },
    async getRepositoryStatus() {
      return status;
    },
    async listRemoteSkills() {
      return remoteSkills;
    },
  };
}

function createPromptStub(responses: string[]): InstallPrompts {
  const queue = [...responses];

  return {
    async search<T extends string>(_message: string, choices: Array<{ value: T }>): Promise<T> {
      const value = queue.shift();

      if (value === undefined) {
        throw new Error('No prompt response configured.');
      }

      if (!choices.some((c) => c.value === value)) {
        throw new Error(`Prompt choice "${value}" is not valid.`);
      }

      return value as T;
    },
  };
}

describe('install bridge', () => {
  test('installSkills shows interactive skill selection when no --skill is provided', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await installSkills(
      {},
      {
        github: createGitHubStub(createRepositoryStatus(), [
          'fastapi-structure',
          'vue-composables',
        ]),
        loadConfig: async () => createConfig(),
        prompts: createPromptStub(['fastapi-structure']),
        runner: {
          async run(command, args) {
            calls.push({ command, args });
          },
        },
        logger: createRecordingLogger(),
      },
    );

    assert.equal(result.registryTarget, 'octocat/skills');
    assert.equal(result.selectedSkill, 'fastapi-structure');
    assert.deepEqual(calls, [
      {
        command: 'npx',
        args: ['skills', 'add', 'octocat/skills', '--skill', 'fastapi-structure'],
      },
    ]);
  });

  test('installSkills returns early when user cancels interactive selection', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const logs: string[] = [];

    const result = await installSkills(
      {},
      {
        github: createGitHubStub(createRepositoryStatus(), ['fastapi-structure']),
        loadConfig: async () => createConfig(),
        prompts: createPromptStub(['__cancel__']),
        runner: {
          async run(command, args) {
            calls.push({ command, args });
          },
        },
        logger: createRecordingLogger(logs),
      },
    );

    assert.deepEqual(calls, []);
    assert.deepEqual(result.args, []);
    assert.match(logs.join('\n'), /Install cancelled/);
  });

  test('installSkills shows empty state when no remote skills exist', async () => {
    const logs: string[] = [];

    const result = await installSkills(
      {},
      {
        github: createGitHubStub(createRepositoryStatus(), []),
        loadConfig: async () => createConfig(),
        prompts: createPromptStub([]),
        runner: {
          async run() {},
        },
        logger: createRecordingLogger(logs),
      },
    );

    assert.deepEqual(result.args, []);
    assert.match(logs.join('\n'), /No skills found in the remote registry/);
  });

  test('installSkills passes through repeated --skill, --agent, -g, -y, and --copy flags', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    await installSkills(
      {
        agent: 'claude-code',
        copy: true,
        global: true,
        skill: ['fastapi-structure', 'vue-composables'],
        yes: true,
      },
      {
        github: createGitHubStub(createRepositoryStatus()),
        loadConfig: async () => createConfig(),
        runner: {
          async run(command, args) {
            calls.push({ command, args });
          },
        },
        logger: createRecordingLogger(),
      },
    );

    assert.deepEqual(calls[0]?.args, [
      'skills',
      'add',
      'octocat/skills',
      '--skill',
      'fastapi-structure',
      '--skill',
      'vue-composables',
      '-g',
      '--agent',
      'claude-code',
      '-y',
      '--copy',
    ]);
  });

  test('installSkills supports --list', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    await installSkills(
      { list: true },
      {
        github: createGitHubStub(createRepositoryStatus()),
        loadConfig: async () => createConfig(),
        runner: {
          async run(command, args) {
            calls.push({ command, args });
          },
        },
        logger: createRecordingLogger(),
      },
    );

    assert.deepEqual(calls[0]?.args, ['skills', 'add', 'octocat/skills', '--list']);
  });

  test('installSkills warns when the registry has no pushed skills', async () => {
    const logs: string[] = [];

    await installSkills(
      {},
      {
        github: createGitHubStub(createRepositoryStatus({ hasSkillsDirectory: false }), []),
        loadConfig: async () => createConfig(),
        prompts: createPromptStub([]),
        runner: {
          async run() {},
        },
        logger: createRecordingLogger(logs),
      },
    );

    assert.match(logs.join('\n'), /no pushed skills yet/i);
  });

  test('installSkills warns when the registry is private', async () => {
    const logs: string[] = [];

    await installSkills(
      {},
      {
        github: createGitHubStub(createRepositoryStatus({ isPrivate: true }), ['some-skill']),
        loadConfig: async () => createConfig(),
        prompts: createPromptStub(['some-skill']),
        runner: {
          async run() {},
        },
        logger: createRecordingLogger(logs),
      },
    );

    assert.match(logs.join('\n'), /requires a public repo/i);
  });

  test('installSkills surfaces a clear npx-not-found error', async () => {
    await assert.rejects(
      () =>
        installSkills(
          { skill: ['some-skill'] },
          {
            github: createGitHubStub(createRepositoryStatus()),
            loadConfig: async () => createConfig(),
            runner: {
              async run() {
                const error = new Error('spawn npx ENOENT') as NodeJS.ErrnoException;
                error.code = 'ENOENT';
                throw error;
              },
            },
            logger: createRecordingLogger(),
          },
        ),
      /Install Node\.js/,
    );
  });

  test('installSkills works without a GitHub token when registry is initialized', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await installSkills(
      {},
      {
        github: createGitHubStub(createRepositoryStatus(), ['my-skill']),
        loadConfig: async () =>
          createConfig({
            githubToken: '',
            githubUsername: '',
          }),
        prompts: createPromptStub(['my-skill']),
        runner: {
          async run(command, args) {
            calls.push({ command, args });
          },
        },
        logger: createRecordingLogger(),
      },
    );

    assert.equal(result.registryTarget, 'octocat/skills');
    assert.equal(result.selectedSkill, 'my-skill');
    assert.deepEqual(calls, [
      {
        command: 'npx',
        args: ['skills', 'add', 'octocat/skills', '--skill', 'my-skill'],
      },
    ]);
  });

  test('installSkills throws when config is not initialized', async () => {
    await assert.rejects(
      () =>
        installSkills(
          {},
          {
            github: createGitHubStub(createRepositoryStatus()),
            loadConfig: async () =>
              createConfig({
                registryRepoUrl: '',
                localRegistryPath: null,
                registryRepoName: null,
              }),
            logger: createRecordingLogger(),
          },
        ),
      /not initialized/,
    );
  });

  test('buildInstallArgs assembles the install command consistently', () => {
    assert.deepEqual(
      installInternals.buildInstallArgs('octocat/skills', {
        agent: 'claude-code',
        copy: true,
        global: true,
        list: true,
        skill: ['fastapi-structure', 'vue-composables'],
        yes: true,
      }),
      [
        'skills',
        'add',
        'octocat/skills',
        '--list',
        '--skill',
        'fastapi-structure',
        '--skill',
        'vue-composables',
        '-g',
        '--agent',
        'claude-code',
        '-y',
        '--copy',
      ],
    );
  });
});
