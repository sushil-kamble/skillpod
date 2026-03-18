import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { simpleGit } from 'simple-git';

import { gitService } from './git.js';
import { initializeSkillPod, type PromptChoice, type PromptService } from './init.js';
import type { RegistryRepository, GitHubService } from './github.js';
import type { SkillPodConfig } from '../types/config.js';
import {
  createSilentLogger,
  createSilentSpinnerFactory,
  createTempDirTracker,
} from '../test-utils/shared.js';

afterEach(async () => {
  await tempDirTracker.cleanup();
});

const tempDirTracker = createTempDirTracker();
const { makeTempDir } = tempDirTracker;

async function createRemoteRepository(repoName: string): Promise<string> {
  const sandbox = await makeTempDir('skillpod-remote-');
  const workingDirectory = path.join(sandbox, `${repoName}-working`);
  const bareDirectory = path.join(sandbox, `${repoName}.git`);

  await fs.mkdir(workingDirectory, { recursive: true });

  const workingGit = simpleGit(workingDirectory);
  await workingGit.init(['--initial-branch=main']);
  await workingGit.addConfig('user.name', 'skillpod-tests', false, 'local');
  await workingGit.addConfig('user.email', 'skillpod-tests@example.com', false, 'local');
  await fs.writeFile(path.join(workingDirectory, 'README.md'), `# ${repoName}\n`, 'utf8');
  await workingGit.add('README.md');
  await workingGit.commit('chore: initialize repository');
  await workingGit.clone('.', bareDirectory, ['--bare']);

  return bareDirectory;
}

class PromptStub implements PromptService {
  constructor(
    private readonly responses: {
      confirm?: boolean[];
      password?: string[];
      input?: string[];
      select?: string[];
    },
  ) {}

  private nextResponse<K extends keyof PromptStub['responses']>(
    key: K,
  ): NonNullable<PromptStub['responses'][K]>[number] {
    const values = this.responses[key];

    if (!values || values.length === 0) {
      throw new Error(`No prompt response configured for ${key}.`);
    }

    const nextValue = values.shift();

    if (nextValue === undefined) {
      throw new Error(`No prompt response configured for ${key}.`);
    }

    return nextValue;
  }

  async confirm(): Promise<boolean> {
    return this.nextResponse('confirm');
  }

  async password(): Promise<string> {
    return this.nextResponse('password');
  }

  async input(): Promise<string> {
    return this.nextResponse('input');
  }

  async select<T extends string>(_message: string, choices: PromptChoice<T>[]): Promise<T> {
    const selectedValue = this.nextResponse('select');

    if (!choices.some((choice) => choice.value === selectedValue)) {
      throw new Error(`Prompt choice "${selectedValue}" is not valid.`);
    }

    return selectedValue as T;
  }
}

function createConfigStore(initialConfig?: Partial<SkillPodConfig>): {
  savedConfig: SkillPodConfig | null;
  loadConfig: () => Promise<SkillPodConfig>;
  saveConfig: (config: Partial<SkillPodConfig>) => Promise<SkillPodConfig>;
} {
  let savedConfig: SkillPodConfig | null = null;

  return {
    get savedConfig() {
      return savedConfig;
    },
    async loadConfig(): Promise<SkillPodConfig> {
      return {
        githubToken: initialConfig?.githubToken ?? '',
        githubUsername: initialConfig?.githubUsername ?? '',
        registryRepoUrl: initialConfig?.registryRepoUrl ?? '',
        localRegistryPath: initialConfig?.localRegistryPath ?? null,
        registryRepoName: initialConfig?.registryRepoName ?? null,
      };
    },
    async saveConfig(config: Partial<SkillPodConfig>): Promise<SkillPodConfig> {
      savedConfig = {
        githubToken: config.githubToken ?? '',
        githubUsername: config.githubUsername ?? '',
        registryRepoUrl: config.registryRepoUrl ?? '',
        localRegistryPath: config.localRegistryPath ?? null,
        registryRepoName: config.registryRepoName ?? null,
      };

      return savedConfig;
    },
  };
}

function createGitHubStub(options: {
  validateToken?: (token: string) => Promise<{ githubToken: string; githubUsername: string }>;
  createSkillsRepository?: (token: string) => Promise<RegistryRepository>;
  getRepository?: (token: string, repoUrl: string) => Promise<RegistryRepository>;
}): GitHubService {
  return {
    validateToken:
      options.validateToken ??
      (async (token: string) => ({
        githubToken: token,
        githubUsername: 'octocat',
        scopes: ['repo'],
      })),
    createSkillsRepository:
      options.createSkillsRepository ??
      (async () => {
        throw new Error('createSkillsRepository was not configured.');
      }),
    getRepository:
      options.getRepository ??
      (async () => {
        throw new Error('getRepository was not configured.');
      }),
  };
}

describe('initializeSkillPod', () => {
  test('auto-create path clones the repository, initializes skills/, and saves config', async () => {
    const remotePath = await createRemoteRepository('skills');
    const localRegistryPath = path.join(await makeTempDir('skillpod-local-'), 'registry');
    const prompts = new PromptStub({
      password: ['valid-token'],
      select: ['auto'],
    });
    const configStore = createConfigStore();
    const github = createGitHubStub({
      createSkillsRepository: async () => ({
        cloneUrl: remotePath,
        htmlUrl: 'https://github.com/octocat/skills',
        owner: 'octocat',
        repo: 'skills',
      }),
    });

    const result = await initializeSkillPod({
      prompts,
      github,
      git: gitService,
      logger: createSilentLogger(),
      loadConfig: configStore.loadConfig,
      saveConfig: configStore.saveConfig,
      getLocalRegistryPath: () => localRegistryPath,
      spinner: createSilentSpinnerFactory(),
    });

    assert.equal(result.status, 'completed');
    assert.equal(configStore.savedConfig?.githubToken, 'valid-token');
    assert.equal(configStore.savedConfig?.githubUsername, 'octocat');
    assert.equal(configStore.savedConfig?.registryRepoUrl, 'https://github.com/octocat/skills');
    assert.equal(configStore.savedConfig?.localRegistryPath, localRegistryPath);
    assert.equal(configStore.savedConfig?.registryRepoName, 'skills');
    await assert.doesNotReject(() => fs.access(path.join(localRegistryPath, 'skills', '.gitkeep')));

    const git = simpleGit(localRegistryPath);
    const log = await git.log();
    assert.equal(log.latest?.message, 'chore: initialize skills directory');
  });

  test('manual path validates repository URL and clones an existing repository', async () => {
    const remotePath = await createRemoteRepository('manual-skills');
    const localRegistryPath = path.join(await makeTempDir('skillpod-manual-'), 'registry');
    const prompts = new PromptStub({
      password: ['valid-token'],
      select: ['manual'],
      input: ['https://github.com/octocat/manual-skills'],
    });
    const configStore = createConfigStore();
    const github = createGitHubStub({
      getRepository: async (_token, repoUrl) => {
        assert.equal(repoUrl, 'https://github.com/octocat/manual-skills');

        return {
          cloneUrl: remotePath,
          htmlUrl: 'https://github.com/octocat/manual-skills',
          owner: 'octocat',
          repo: 'manual-skills',
        };
      },
    });

    const result = await initializeSkillPod({
      prompts,
      github,
      git: gitService,
      logger: createSilentLogger(),
      loadConfig: configStore.loadConfig,
      saveConfig: configStore.saveConfig,
      getLocalRegistryPath: () => localRegistryPath,
      spinner: createSilentSpinnerFactory(),
    });

    assert.equal(result.status, 'completed');
    await assert.doesNotReject(() => fs.access(path.join(localRegistryPath, 'README.md')));
    await assert.doesNotReject(() => fs.access(path.join(localRegistryPath, 'skills', '.gitkeep')));
  });

  test('invalid token is retried before continuing', async () => {
    const remotePath = await createRemoteRepository('skills');
    const localRegistryPath = path.join(await makeTempDir('skillpod-retry-'), 'registry');
    let attempts = 0;
    const prompts = new PromptStub({
      password: ['bad-token', 'valid-token'],
      select: ['auto'],
    });
    const configStore = createConfigStore();
    const github = createGitHubStub({
      validateToken: async (token: string) => {
        attempts += 1;

        if (token === 'bad-token') {
          throw new Error('GitHub rejected that token.');
        }

        return {
          githubToken: token,
          githubUsername: 'octocat',
          scopes: ['repo'],
        };
      },
      createSkillsRepository: async () => ({
        cloneUrl: remotePath,
        htmlUrl: 'https://github.com/octocat/skills',
        owner: 'octocat',
        repo: 'skills',
      }),
    });

    const result = await initializeSkillPod({
      prompts,
      github,
      git: gitService,
      logger: createSilentLogger(),
      loadConfig: configStore.loadConfig,
      saveConfig: configStore.saveConfig,
      getLocalRegistryPath: () => localRegistryPath,
      spinner: createSilentSpinnerFactory(),
    });

    assert.equal(result.status, 'completed');
    assert.equal(attempts, 2);
  });

  test('existing non-git target directory aborts initialization with a clear error', async () => {
    const localRoot = await makeTempDir('skillpod-existing-');
    const localRegistryPath = path.join(localRoot, 'registry');
    await fs.mkdir(localRegistryPath, { recursive: true });
    await fs.writeFile(path.join(localRegistryPath, 'random.txt'), 'not a repo\n', 'utf8');

    const prompts = new PromptStub({
      password: ['valid-token'],
      select: ['auto'],
    });
    const configStore = createConfigStore();
    const github = createGitHubStub({
      createSkillsRepository: async () => ({
        cloneUrl: await createRemoteRepository('skills'),
        htmlUrl: 'https://github.com/octocat/skills',
        owner: 'octocat',
        repo: 'skills',
      }),
    });

    await assert.rejects(
      () =>
        initializeSkillPod({
          prompts,
          github,
          git: gitService,
          logger: createSilentLogger(),
          loadConfig: configStore.loadConfig,
          saveConfig: configStore.saveConfig,
          getLocalRegistryPath: () => localRegistryPath,
          spinner: createSilentSpinnerFactory(),
        }),
      /is not a git repository/,
    );
  });

  test('reinitialize can be declined without modifying config', async () => {
    const prompts = new PromptStub({
      confirm: [false],
    });
    const configStore = createConfigStore({
      githubToken: 'existing-token',
      githubUsername: 'octocat',
      registryRepoUrl: 'https://github.com/octocat/skills',
      localRegistryPath: '/tmp/existing-registry',
      registryRepoName: 'skills',
    });

    const result = await initializeSkillPod({
      prompts,
      github: createGitHubStub({}),
      git: gitService,
      logger: createSilentLogger(),
      loadConfig: configStore.loadConfig,
      saveConfig: configStore.saveConfig,
      spinner: createSilentSpinnerFactory(),
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(configStore.savedConfig, null);
  });
});
