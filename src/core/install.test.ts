import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { installInternals, installSkills } from './install.js';
import type { GitHubService, RegistryRepositoryStatus } from './github.js';
import type { SkillForgeConfig } from '../types/config.js';
import { createRecordingLogger } from '../test-utils/shared.js';

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

function createGitHubStub(status: RegistryRepositoryStatus): GitHubService {
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
    async getRepositoryStatus() {
      return status;
    },
  };
}

describe('install bridge', () => {
  test('installSkills spawns npx skills add <username>/skills', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await installSkills(
      {},
      {
        github: createGitHubStub(createRepositoryStatus()),
        loadConfig: async () => createConfig(),
        runner: {
          async run(command, args) {
            calls.push({ command, args });
            return 0;
          },
        },
        logger: createRecordingLogger(),
      },
    );

    assert.equal(result.registryTarget, 'octocat/skills');
    assert.deepEqual(calls, [
      {
        command: 'npx',
        args: ['skills', 'add', 'octocat/skills'],
      },
    ]);
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
            return 0;
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
            return 0;
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
        github: createGitHubStub(createRepositoryStatus({ hasSkillsDirectory: false })),
        loadConfig: async () => createConfig(),
        runner: {
          async run() {
            return 0;
          },
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
        github: createGitHubStub(createRepositoryStatus({ isPrivate: true })),
        loadConfig: async () => createConfig(),
        runner: {
          async run() {
            return 0;
          },
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
          {},
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
