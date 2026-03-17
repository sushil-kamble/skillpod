import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { runDoctor } from './doctor.js';
import type { GitHubService } from './github.js';
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

function createGitHubStub(options?: {
  validateToken?: () => Promise<void>;
}): GitHubService {
  return {
    async validateToken() {
      if (options?.validateToken) {
        await options.validateToken();
        return {
          githubToken: 'token',
          githubUsername: 'octocat',
          scopes: ['repo'],
        };
      }

      return {
        githubToken: 'token',
        githubUsername: 'octocat',
        scopes: ['repo'],
      };
    },
    async createSkillsRepository() {
      throw new Error('unused');
    },
    async getRepository() {
      throw new Error('unused');
    },
    async getRepositoryStatus() {
      throw new Error('unused');
    },
  };
}

describe('doctor checks', () => {
  test('runDoctor reports all pass checks on a healthy initialized setup', async () => {
    const logs: string[] = [];
    const result = await runDoctor({
      configFilePath: '/tmp/config.json',
      github: createGitHubStub(),
      loadConfig: async () => createConfig(),
      logger: createRecordingLogger(logs),
      makeGit: () => ({
        async checkIsRepo() {
          return true;
        },
        async listRemote() {
          return 'ok';
        },
      }),
      pathExists: async () => true,
      readFile: async () => '{"ok":true}',
      resolveExecutable: async () => '/usr/bin/npx',
    });

    assert.equal(result.ok, true);
    assert.equal(result.checks.every((check) => check.status === 'pass'), true);
    assert.match(logs.join('\n'), /PASS Config file/);
    assert.match(logs.join('\n'), /PASS npx/);
  });

  test('runDoctor reports clear failures on an uninitialized setup', async () => {
    const logs: string[] = [];
    const result = await runDoctor({
      configFilePath: '/tmp/missing.json',
      github: createGitHubStub(),
      loadConfig: async () => createConfig({
        githubToken: '',
        githubUsername: '',
        registryRepoUrl: '',
        localRegistryPath: null,
        registryRepoName: null,
      }),
      logger: createRecordingLogger(logs),
      pathExists: async () => false,
      readFile: async () => {
        throw new Error('missing');
      },
      resolveExecutable: async () => null,
    });

    assert.equal(result.ok, false);
    assert.match(logs.join('\n'), /FAIL Config file/);
    assert.match(logs.join('\n'), /FAIL Local registry/);
    assert.match(logs.join('\n'), /FAIL npx/);
  });

  test('runDoctor marks the GitHub API as unreachable instead of crashing', async () => {
    const result = await runDoctor({
      configFilePath: '/tmp/config.json',
      github: createGitHubStub({
        async validateToken() {
          throw new Error('GitHub API unreachable: connection timed out');
        },
      }),
      loadConfig: async () => createConfig(),
      logger: createRecordingLogger(),
      makeGit: () => ({
        async checkIsRepo() {
          return true;
        },
        async listRemote() {
          return 'ok';
        },
      }),
      pathExists: async () => true,
      readFile: async () => '{"ok":true}',
      resolveExecutable: async () => '/usr/bin/npx',
    });

    assert.equal(result.checks.find((check) => check.label === 'GitHub token')?.status, 'unreachable');
  });

  test('runDoctor reads config once on a healthy initialized setup', async () => {
    let loadConfigCalls = 0;

    await runDoctor({
      configFilePath: '/tmp/config.json',
      github: createGitHubStub(),
      loadConfig: async () => {
        loadConfigCalls += 1;
        return createConfig();
      },
      logger: createRecordingLogger(),
      makeGit: () => ({
        async checkIsRepo() {
          return true;
        },
        async listRemote() {
          return 'ok';
        },
      }),
      pathExists: async () => true,
      readFile: async () => '{"ok":true}',
      resolveExecutable: async () => '/usr/bin/npx',
    });

    assert.equal(loadConfigCalls, 1);
  });
});
