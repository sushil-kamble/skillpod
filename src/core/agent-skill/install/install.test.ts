import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { installInternals, installSkills } from '#core/agent-skill/install/install.js';
import type { GitHubService, RegistryRepositoryStatus } from '#core/global/github/github.js';
import type { InstallPrompts } from '#core/agent-skill/install/install.js';
import type { SkillPodConfig } from '#types/config.js';
import { createRecordingLogger } from '#test-utils/shared.js';

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
  test('installSkills shows interactive skill selection when no skill name is provided', async () => {
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

  test('installSkills installs a specific skill by name', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await installSkills(
      { skill: 'fastapi-structure' },
      {
        github: createGitHubStub(createRepositoryStatus(), [
          'fastapi-structure',
          'vue-composables',
        ]),
        loadConfig: async () => createConfig(),
        runner: {
          async run(command, args) {
            calls.push({ command, args });
          },
        },
        logger: createRecordingLogger(),
      },
    );

    assert.equal(result.selectedSkill, 'fastapi-structure');
    assert.deepEqual(calls, [
      {
        command: 'npx',
        args: ['skills', 'add', 'octocat/skills', '--skill', 'fastapi-structure'],
      },
    ]);
  });

  test('installSkills throws with available skills when skill name is not found', async () => {
    await assert.rejects(
      () =>
        installSkills(
          { skill: 'nonexistent-skill' },
          {
            github: createGitHubStub(createRepositoryStatus(), [
              'fastapi-structure',
              'vue-composables',
              'react-hooks',
            ]),
            loadConfig: async () => createConfig(),
            runner: {
              async run() {},
            },
            logger: createRecordingLogger(),
          },
        ),
      (error: Error) => {
        assert.match(error.message, /Skill "nonexistent-skill" not found/);
        assert.match(error.message, /fastapi-structure/);
        assert.match(error.message, /vue-composables/);
        assert.match(error.message, /react-hooks/);
        return true;
      },
    );
  });

  test('installSkills throws with empty registry message when skill not found and no skills exist', async () => {
    await assert.rejects(
      () =>
        installSkills(
          { skill: 'nonexistent-skill' },
          {
            github: createGitHubStub(createRepositoryStatus(), []),
            loadConfig: async () => createConfig(),
            runner: {
              async run() {},
            },
            logger: createRecordingLogger(),
          },
        ),
      /No skills are available/,
    );
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

  test('installSkills logs info and passes git auth env vars when registry is private and token is present', async () => {
    const logs: string[] = [];
    const capturedEnvs: Array<NodeJS.ProcessEnv | undefined> = [];

    await installSkills(
      {},
      {
        github: createGitHubStub(createRepositoryStatus({ isPrivate: true }), ['some-skill']),
        loadConfig: async () => createConfig({ githubToken: 'ghp_secret' }),
        prompts: createPromptStub(['some-skill']),
        runner: {
          async run(_command, _args, env) {
            capturedEnvs.push(env);
          },
        },
        logger: createRecordingLogger(logs),
      },
    );

    assert.match(logs.join('\n'), /authenticating with your stored github token/i);
    const env = capturedEnvs[0];
    assert.equal(env?.['GITHUB_TOKEN'], 'ghp_secret');
    assert.equal(env?.['GH_TOKEN'], 'ghp_secret');
    assert.equal(env?.['GIT_CONFIG_COUNT'], '1');
    assert.equal(env?.['GIT_CONFIG_KEY_0'], 'url.https://ghp_secret@github.com/.insteadOf');
    assert.equal(env?.['GIT_CONFIG_VALUE_0'], 'https://github.com/');
  });

  test('installSkills does not inject git auth env vars when registry is public', async () => {
    const capturedEnvs: Array<NodeJS.ProcessEnv | undefined> = [];

    await installSkills(
      { skill: 'some-skill' },
      {
        github: createGitHubStub(createRepositoryStatus({ isPrivate: false }), ['some-skill']),
        loadConfig: async () => createConfig({ githubToken: 'ghp_secret' }),
        runner: {
          async run(_command, _args, env) {
            capturedEnvs.push(env);
          },
        },
        logger: createRecordingLogger(),
      },
    );

    const env = capturedEnvs[0];
    assert.equal(env?.['GIT_CONFIG_COUNT'], undefined);
    assert.equal(env?.['GIT_CONFIG_KEY_0'], undefined);
    assert.equal(env?.['GIT_CONFIG_VALUE_0'], undefined);
  });

  test('installSkills warns when the registry is private and no token is configured', async () => {
    const logs: string[] = [];

    await installSkills(
      {},
      {
        github: createGitHubStub(createRepositoryStatus({ isPrivate: true }), ['some-skill']),
        loadConfig: async () => createConfig({ githubToken: '' }),
        prompts: createPromptStub(['some-skill']),
        runner: {
          async run() {},
        },
        logger: createRecordingLogger(logs),
      },
    );

    assert.match(logs.join('\n'), /no github token is configured/i);
  });

  test('installSkills surfaces a clear npx-not-found error', async () => {
    await assert.rejects(
      () =>
        installSkills(
          { skill: 'some-skill' },
          {
            github: createGitHubStub(createRepositoryStatus(), ['some-skill']),
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

  test('installSkills forwards passthrough flags to npx skills add', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    await installSkills(
      {
        skill: 'fastapi-structure',
        passthrough: ['-a', 'claude-code', '-a', 'opencode', '-g', '-y'],
      },
      {
        github: createGitHubStub(createRepositoryStatus(), ['fastapi-structure']),
        loadConfig: async () => createConfig(),
        runner: {
          async run(command, args) {
            calls.push({ command, args });
          },
        },
        logger: createRecordingLogger(),
      },
    );

    assert.deepEqual(calls, [
      {
        command: 'npx',
        args: [
          'skills',
          'add',
          'octocat/skills',
          '--skill',
          'fastapi-structure',
          '-a',
          'claude-code',
          '-a',
          'opencode',
          '-g',
          '-y',
        ],
      },
    ]);
  });

  test('installSkills forwards --copy flag via passthrough', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    await installSkills(
      {
        skill: 'my-skill',
        passthrough: ['--copy'],
      },
      {
        github: createGitHubStub(createRepositoryStatus(), ['my-skill']),
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
      'my-skill',
      '--copy',
    ]);
  });

  test('buildInstallArgs assembles the install command correctly', () => {
    assert.deepEqual(installInternals.buildInstallArgs('octocat/skills', 'fastapi-structure', []), [
      'skills',
      'add',
      'octocat/skills',
      '--skill',
      'fastapi-structure',
    ]);
  });

  test('buildInstallArgs appends passthrough flags', () => {
    assert.deepEqual(
      installInternals.buildInstallArgs('octocat/skills', 'fastapi-structure', [
        '-g',
        '-a',
        'claude-code',
      ]),
      [
        'skills',
        'add',
        'octocat/skills',
        '--skill',
        'fastapi-structure',
        '-g',
        '-a',
        'claude-code',
      ],
    );
  });
});
