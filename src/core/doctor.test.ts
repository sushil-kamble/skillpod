import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { runDoctor } from './doctor.js';
import type { GitHubService } from './github.js';
import type { SkillCreatorService } from './skill-creator.js';
import type { SkillPodConfig } from '../types/config.js';
import { createRecordingLogger, createSilentSpinnerFactory } from '../test-utils/shared.js';

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

function createSkillCreatorStub(options?: {
  availability?: {
    availableAgents?: string[];
    missingAgents?: string[];
    unverifiedAgents?: string[];
  };
}): Pick<SkillCreatorService, 'buildDoctorDetail' | 'detectAvailability'> {
  return {
    buildDoctorDetail(availability) {
      if (availability.availableAgents.length > 0) {
        return `Installed for ${availability.availableAgents.join(', ')}.`;
      }

      const parts: string[] = [];

      if (availability.missingAgents.length > 0) {
        parts.push(`missing for ${availability.missingAgents.join(', ')}`);
      }

      if (availability.unverifiedAgents.length > 0) {
        parts.push(`unverified for ${availability.unverifiedAgents.join(', ')}`);
      }

      const prefix = parts.length > 0 ? `${parts.join('; ')}. ` : '';

      return `${prefix}Recommended install: npx skills add https://github.com/anthropics/skills --skill skill-creator -g -a claude-code -a opencode -a codex`;
    },
    async detectAvailability() {
      return {
        availableAgents: (options?.availability?.availableAgents ?? []) as Array<
          'claude-code' | 'opencode' | 'codex'
        >,
        missingAgents: (options?.availability?.missingAgents ?? []) as Array<
          'claude-code' | 'opencode' | 'codex'
        >,
        unverifiedAgents: (options?.availability?.unverifiedAgents ?? []) as Array<
          'claude-code' | 'opencode' | 'codex'
        >,
      };
    },
  };
}

function createGitHubStub(options?: { validateToken?: () => Promise<void> }): GitHubService {
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
    async listRemoteSkills() {
      return [];
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
      skillCreator: createSkillCreatorStub({
        availability: {
          availableAgents: ['claude-code', 'opencode', 'codex'],
        },
      }),
      spinner: createSilentSpinnerFactory(),
    });

    assert.equal(result.ok, true);
    assert.equal(
      result.checks.every((check) => check.status === 'pass'),
      true,
    );
    assert.match(logs.join('\n'), /PASS Config file/);
    assert.match(logs.join('\n'), /PASS npx/);
    assert.match(logs.join('\n'), /PASS skill-creator/);
  });

  test('runDoctor reports clear failures on an uninitialized setup', async () => {
    const logs: string[] = [];
    const result = await runDoctor({
      configFilePath: '/tmp/missing.json',
      github: createGitHubStub(),
      loadConfig: async () =>
        createConfig({
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
      skillCreator: createSkillCreatorStub({
        availability: {
          unverifiedAgents: ['claude-code', 'opencode', 'codex'],
        },
      }),
      spinner: createSilentSpinnerFactory(),
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
      skillCreator: createSkillCreatorStub({
        availability: {
          availableAgents: ['claude-code', 'opencode'],
          missingAgents: ['codex'],
        },
      }),
      spinner: createSilentSpinnerFactory(),
    });

    assert.equal(
      result.checks.find((check) => check.label === 'GitHub token')?.status,
      'unreachable',
    );
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
      skillCreator: createSkillCreatorStub({
        availability: {
          availableAgents: ['claude-code', 'opencode', 'codex'],
        },
      }),
      spinner: createSilentSpinnerFactory(),
    });

    assert.equal(loadConfigCalls, 1);
  });

  test('runDoctor marks skill-creator as pass when installed for at least one agent', async () => {
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
      skillCreator: createSkillCreatorStub({
        availability: {
          availableAgents: ['claude-code'],
          missingAgents: ['opencode', 'codex'],
        },
      }),
      spinner: createSilentSpinnerFactory(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.checks.find((check) => check.label === 'skill-creator')?.status, 'pass');
    assert.match(logs.join('\n'), /PASS skill-creator/);
  });

  test('runDoctor marks skill-creator as recommended when not installed for any agent', async () => {
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
      skillCreator: createSkillCreatorStub({
        availability: {
          missingAgents: ['claude-code', 'opencode', 'codex'],
        },
      }),
      spinner: createSilentSpinnerFactory(),
    });

    assert.equal(result.ok, true);
    assert.equal(
      result.checks.find((check) => check.label === 'skill-creator')?.status,
      'recommended',
    );
    assert.match(logs.join('\n'), /RECOMMENDED skill-creator/);
  });
});
