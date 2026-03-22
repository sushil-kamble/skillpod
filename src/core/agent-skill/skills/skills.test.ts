import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  createSkill,
  editSkill,
  listSkills,
  removeSkill,
  skillsInternals,
  type PromptChoice,
  type SkillPrompts,
} from '#core/agent-skill/skills/skills.js';
import type { SkillCreatorService } from '#core/agent-skill/skill-creator/skill-creator.js';
import type { SkillPodConfig } from '#types/config.js';
import type { EditorService } from '#utils/io/editor.js';
import {
  createRecordingLogger,
  createSilentLogger,
  createTempDirTracker,
} from '#test-utils/shared.js';

afterEach(async () => {
  await tempDirTracker.cleanup();
});

const tempDirTracker = createTempDirTracker();
const { makeTempDir } = tempDirTracker;

async function createInitializedConfig(): Promise<SkillPodConfig> {
  const root = await makeTempDir('skillpod-skills-');
  const localRegistryPath = path.join(root, 'registry');
  await fs.mkdir(path.join(localRegistryPath, 'skills'), { recursive: true });

  return {
    githubToken: 'token',
    githubUsername: 'octocat',
    registryRepoUrl: 'https://github.com/octocat/skills',
    localRegistryPath,
    registryRepoName: 'skills',
  };
}

class PromptStub implements SkillPrompts {
  constructor(
    private readonly responses: {
      input?: string[];
      confirm?: boolean[];
      search?: string[];
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

  async input(): Promise<string> {
    return this.nextResponse('input');
  }

  async confirm(): Promise<boolean> {
    return this.nextResponse('confirm');
  }

  async search<T extends string>(_message: string, choices: PromptChoice<T>[]): Promise<T> {
    const value = this.nextResponse('search');

    if (!choices.some((choice) => choice.value === value)) {
      throw new Error(`Prompt choice "${value}" is not valid.`);
    }

    return value as T;
  }

  async select<T extends string>(_message: string, choices: PromptChoice<T>[]): Promise<T> {
    const value = this.nextResponse('select');

    if (!choices.some((choice) => choice.value === value)) {
      throw new Error(`Prompt choice "${value}" is not valid.`);
    }

    return value as T;
  }
}

function createEditorStub(openedFiles: string[]): EditorService {
  return {
    async open(filePath: string): Promise<{ opened: boolean; targetPath: string }> {
      openedFiles.push(filePath);
      return {
        opened: true,
        targetPath: filePath,
      };
    },
  };
}

const noopClipboard = async (): Promise<boolean> => false;
const noopGetLocalChanges = async (): Promise<boolean> => false;

function createSkillCreatorStub(options?: {
  availability?: {
    availableAgents?: string[];
    missingAgents?: string[];
    unverifiedAgents?: string[];
  };
  install?: () => Promise<void>;
}): SkillCreatorService {
  return {
    buildCreatePrompt(skillName: string, skillDirectory: string): string {
      return `CREATE PROMPT ${skillName} ${skillDirectory}`;
    },
    buildDoctorDetail(): string {
      return 'unused';
    },
    buildEditPrompt(skillName: string, skillDirectory: string): string {
      return `EDIT PROMPT ${skillName} ${skillDirectory}`;
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
    getInstallCommand(): string {
      return 'npx skills add https://github.com/anthropics/skills --skill skill-creator -g -a claude-code -a opencode -a codex';
    },
    async install() {
      if (options?.install) {
        await options.install();
      }
    },
  };
}

async function writeSkillFile(
  config: SkillPodConfig,
  skillName: string,
  content = skillsInternals.getDefaultSkillTemplate(skillName),
): Promise<string> {
  const skillDirectory = path.join(config.localRegistryPath!, 'skills', skillName);
  const skillFilePath = path.join(skillDirectory, 'SKILL.md');
  await fs.mkdir(skillDirectory, { recursive: true });
  await fs.writeFile(skillFilePath, content, 'utf8');
  return skillFilePath;
}

describe('skill authoring commands', () => {
  test('createSkill creates a skill file with the default template', async () => {
    const config = await createInitializedConfig();
    const openedFiles: string[] = [];

    await createSkill(
      { name: 'fastapi-structure' },
      {
        prompts: new PromptStub({ select: ['open-vscode'] }),
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createSilentLogger(),
      },
    );

    const skillFilePath = path.join(
      config.localRegistryPath!,
      'skills',
      'fastapi-structure',
      'SKILL.md',
    );
    const skillDirectory = path.join(config.localRegistryPath!, 'skills', 'fastapi-structure');
    const content = await fs.readFile(skillFilePath, 'utf8');

    assert.match(content, /^---\nname: fastapi-structure\n/);
    assert.match(content, /description:\n  \[Describe what this skill does/);
    assert.deepEqual(openedFiles, [skillDirectory]);
  });

  test('createSkill rejects invalid names with a clear validation message', async () => {
    const config = await createInitializedConfig();

    await assert.rejects(
      () =>
        createSkill(
          { name: 'INVALID NAME' },
          {
            loadConfig: async () => config,
            logger: createSilentLogger(),
          },
        ),
      /Skill name must be lowercase, use hyphens only, and contain no spaces or special characters\./,
    );
  });

  test('createSkill rejects unknown --mode values', async () => {
    const config = await createInitializedConfig();

    await assert.rejects(
      () =>
        createSkill(
          { name: 'my-skill', mode: 'invalid-mode' as never },
          {
            loadConfig: async () => config,
            logger: createSilentLogger(),
          },
        ),
      /Invalid --mode "invalid-mode". Valid values: open-vscode, skip, use-skill-creator\./,
    );
  });

  test('editSkill rejects unknown --mode values', async () => {
    const config = await createInitializedConfig();
    await writeSkillFile(config, 'my-skill');

    await assert.rejects(
      () =>
        editSkill(
          { name: 'my-skill', mode: 'bogus' as never },
          {
            loadConfig: async () => config,
            logger: createSilentLogger(),
          },
        ),
      /Invalid --mode "bogus". Valid values: open-vscode, skip, use-skill-creator\./,
    );
  });

  test('listSkills returns skills and opens authoring mode on selection', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    const openedFiles: string[] = [];
    await writeSkillFile(
      config,
      'fastapi-structure',
      `---
name: fastapi-structure
description:
  Build a clean FastAPI project structure for backend services.
---

# FastAPI Structure
`,
    );

    const skills = await listSkills(
      {},
      {
        prompts: new PromptStub({
          select: ['fastapi-structure', 'open-vscode'],
        }),
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createRecordingLogger(logs),
        getLocalChanges: noopGetLocalChanges,
      },
    );

    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.name, 'fastapi-structure');
    assert.equal(
      skills[0]?.description,
      'Build a clean FastAPI project structure for backend services.',
    );
    const skillDirectory = path.join(config.localRegistryPath!, 'skills', 'fastapi-structure');
    assert.deepEqual(openedFiles, [skillDirectory]);
  });

  test('listSkills returns skills without opening when cancelled', async () => {
    const config = await createInitializedConfig();
    const openedFiles: string[] = [];
    await writeSkillFile(config, 'fastapi-structure');

    const skills = await listSkills(
      {},
      {
        prompts: new PromptStub({ select: ['__cancel__'] }),
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createSilentLogger(),
        getLocalChanges: noopGetLocalChanges,
      },
    );

    assert.equal(skills.length, 1);
    assert.deepEqual(openedFiles, []);
  });

  test('listSkills creates a missing skills directory and shows the empty state', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    await fs.rm(path.join(config.localRegistryPath!, 'skills'), { recursive: true, force: true });

    const skills = await listSkills(
      {},
      {
        loadConfig: async () => config,
        logger: createRecordingLogger(logs),
      },
    );

    assert.deepEqual(skills, []);
    await assert.doesNotReject(() => fs.access(path.join(config.localRegistryPath!, 'skills')));
    assert.equal(logs[0], skillsInternals.EMPTY_STATE_MESSAGE);
  });

  test('listSkills shows sync status for each skill', async () => {
    const config = await createInitializedConfig();
    await writeSkillFile(config, 'synced-skill');
    await writeSkillFile(config, 'changed-skill');

    let capturedChoices: PromptChoice<string>[] = [];

    const skills = await listSkills(
      {},
      {
        prompts: {
          async input() {
            throw new Error('should not be called');
          },
          async confirm() {
            throw new Error('should not be called');
          },
          async search() {
            throw new Error('should not be called');
          },
          async select<T extends string>(_message: string, choices: PromptChoice<T>[]): Promise<T> {
            capturedChoices = choices;
            return '__cancel__' as T;
          },
        },
        loadConfig: async () => config,
        logger: createSilentLogger(),
      },
    );

    assert.equal(skills.length, 2);
    assert.equal(
      capturedChoices
        .filter((choice) => choice.value !== '__cancel__')
        .some((choice) => choice.description !== undefined),
      false,
    );
  });

  test('editSkill opens the requested skill directory in the editor', async () => {
    const config = await createInitializedConfig();
    const openedFiles: string[] = [];
    await writeSkillFile(config, 'fastapi-structure');
    const skillDirectory = path.join(config.localRegistryPath!, 'skills', 'fastapi-structure');

    await editSkill(
      { name: 'fastapi-structure' },
      {
        prompts: new PromptStub({ select: ['open-vscode'] }),
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createSilentLogger(),
      },
    );

    assert.deepEqual(openedFiles, [skillDirectory]);
  });

  test('createSkill prints a ready-to-copy prompt when skill-creator is selected and available', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    const openedFiles: string[] = [];

    await createSkill(
      { name: 'fastapi-best-practices' },
      {
        prompts: new PromptStub({ select: ['use-skill-creator'] }),
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createRecordingLogger(logs),
        copyToClipboard: noopClipboard,
        skillCreator: createSkillCreatorStub({
          availability: {
            availableAgents: ['claude-code'],
            missingAgents: ['opencode', 'codex'],
          },
        }),
      },
    );

    assert.deepEqual(openedFiles, []);
    assert.match(logs.join('\n'), /CREATE PROMPT fastapi-best-practices/);
  });

  test('editSkill prints a ready-to-copy prompt when skill-creator is selected and available', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    const openedFiles: string[] = [];
    await writeSkillFile(config, 'fastapi-best-practices');

    await editSkill(
      { name: 'fastapi-best-practices' },
      {
        prompts: new PromptStub({ select: ['use-skill-creator'] }),
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createRecordingLogger(logs),
        copyToClipboard: noopClipboard,
        skillCreator: createSkillCreatorStub({
          availability: {
            availableAgents: ['claude-code'],
          },
        }),
      },
    );

    assert.deepEqual(openedFiles, []);
    assert.match(logs.join('\n'), /EDIT PROMPT fastapi-best-practices/);
  });

  test('createSkill offers to install skill-creator and prints the prompt after install', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    let installCalls = 0;

    await createSkill(
      { name: 'fastapi-best-practices' },
      {
        prompts: new PromptStub({
          confirm: [true],
          select: ['use-skill-creator'],
        }),
        loadConfig: async () => config,
        logger: createRecordingLogger(logs),
        copyToClipboard: noopClipboard,
        skillCreator: createSkillCreatorStub({
          availability: {
            missingAgents: ['claude-code', 'opencode', 'codex'],
          },
          async install() {
            installCalls += 1;
          },
        }),
      },
    );

    assert.equal(installCalls, 1);
    assert.match(logs.join('\n'), /Installed skill-creator globally\./);
    assert.match(logs.join('\n'), /CREATE PROMPT fastapi-best-practices/);
  });

  test('createSkill falls back to VS Code when skill-creator install is declined', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    const openedFiles: string[] = [];
    const skillDirectory = path.join(config.localRegistryPath!, 'skills', 'fastapi-best-practices');

    await createSkill(
      { name: 'fastapi-best-practices' },
      {
        prompts: new PromptStub({
          confirm: [false],
          select: ['use-skill-creator'],
        }),
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createRecordingLogger(logs),
        copyToClipboard: noopClipboard,
        skillCreator: createSkillCreatorStub({
          availability: {
            missingAgents: ['claude-code', 'opencode', 'codex'],
          },
        }),
      },
    );

    assert.deepEqual(openedFiles, [skillDirectory]);
    assert.match(logs.join('\n'), /Falling back to manual editing in VS Code\./);
  });

  test('editSkill cancels when cancel is selected in authoring mode', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    const openedFiles: string[] = [];
    await writeSkillFile(config, 'fastapi-best-practices');

    await editSkill(
      { name: 'fastapi-best-practices' },
      {
        prompts: new PromptStub({ select: ['skip'] }),
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createRecordingLogger(logs),
      },
    );

    assert.deepEqual(openedFiles, []);
    assert.match(logs.join('\n'), /Edit cancelled\./);
  });

  test('removeSkill confirms before deleting the skill directory', async () => {
    const config = await createInitializedConfig();
    const skillFilePath = await writeSkillFile(config, 'fastapi-structure');

    const removed = await removeSkill(
      { name: 'fastapi-structure' },
      {
        loadConfig: async () => config,
        prompts: new PromptStub({ confirm: [true, false] }),
        logger: createSilentLogger(),
      },
    );

    assert.equal(removed, 'fastapi-structure');
    await assert.rejects(() => fs.access(skillFilePath));
  });

  test('removeSkill shows interactive selection when no name is provided', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    await writeSkillFile(config, 'fastapi-structure');
    await writeSkillFile(config, 'vue-composables');

    const removed = await removeSkill(
      {},
      {
        loadConfig: async () => config,
        prompts: new PromptStub({
          select: ['vue-composables'],
          confirm: [true, false],
        }),
        logger: createRecordingLogger(logs),
      },
    );

    assert.equal(removed, 'vue-composables');
    assert.match(logs.join('\n'), /Removed skill "vue-composables" locally/);
  });

  test('removeSkill returns null when interactive selection is cancelled', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    await writeSkillFile(config, 'fastapi-structure');

    const removed = await removeSkill(
      {},
      {
        loadConfig: async () => config,
        prompts: new PromptStub({ select: ['__cancel__'] }),
        logger: createRecordingLogger(logs),
      },
    );

    assert.equal(removed, null);
    assert.match(logs.join('\n'), /Remove cancelled/);
  });

  test('removeSkill pushes to remote when user confirms', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    let pushMessage: string | undefined;
    await writeSkillFile(config, 'fastapi-structure');

    const removed = await removeSkill(
      { name: 'fastapi-structure' },
      {
        loadConfig: async () => config,
        prompts: new PromptStub({ confirm: [true, true] }),
        logger: createRecordingLogger(logs),
        pushToRemote: async (message: string) => {
          pushMessage = message;
          return true;
        },
      },
    );

    assert.equal(removed, 'fastapi-structure');
    assert.match(pushMessage!, /remove skill "fastapi-structure"/);
    assert.match(logs.join('\n'), /Removal pushed to remote/);
  });

  test('removeSkill shows empty state when no skills exist', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];

    const removed = await removeSkill(
      { name: 'nonexistent' },
      {
        loadConfig: async () => config,
        prompts: new PromptStub({}),
        logger: createRecordingLogger(logs),
      },
    );

    assert.equal(removed, null);
    assert.match(logs.join('\n'), /No skills found/);
  });

  test('removeSkill offers suggestions when named skill does not exist', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    await writeSkillFile(config, 'existing-skill');

    await assert.rejects(
      () =>
        removeSkill(
          { name: 'nonexistent' },
          {
            loadConfig: async () => config,
            prompts: new PromptStub({ select: ['__cancel__'] }),
            logger: createRecordingLogger(logs),
          },
        ),
      /Operation cancelled\./,
    );

    assert.match(logs.join('\n'), /not found/);
  });

  test('listSkills marks invalid frontmatter instead of crashing', async () => {
    const config = await createInitializedConfig();
    await writeSkillFile(
      config,
      'broken-skill',
      `---
description: Missing the required name field
---

# Broken Skill
`,
    );

    const skills = await listSkills(
      {},
      {
        prompts: new PromptStub({ select: ['__cancel__'] }),
        loadConfig: async () => config,
        logger: createSilentLogger(),
        getLocalChanges: noopGetLocalChanges,
      },
    );

    assert.equal(skills[0]?.valid, false);
    assert.equal(skills[0]?.description, skillsInternals.DESCRIPTION_FALLBACK);
  });

  test('parseFrontmatter folds block-scalar descriptions instead of returning ">"', () => {
    const parsed = skillsInternals.parseFrontmatter(`---
name: npm-pkg-expert
description: >
  Expert guide for building and publishing npm packages.
  Includes lint, test, and build checks.
---

# NPM Package Expert
`);

    assert.equal(parsed.valid, true);
    assert.equal(
      parsed.description,
      'Expert guide for building and publishing npm packages. Includes lint, test, and build checks.',
    );
  });

  test('listSkills renders folded descriptions inline without stray arrows', async () => {
    const config = await createInitializedConfig();
    await writeSkillFile(
      config,
      'npm-pkg-expert',
      `---
name: npm-pkg-expert
description: >
  Expert guide for building, maintaining, and publishing high-quality npm packages.
---

# NPM Package Expert
`,
    );

    let capturedChoices: PromptChoice<string>[] = [];

    await listSkills(
      {},
      {
        prompts: {
          async input() {
            throw new Error('should not be called');
          },
          async confirm() {
            throw new Error('should not be called');
          },
          async search() {
            throw new Error('should not be called');
          },
          async select<T extends string>(_message: string, choices: PromptChoice<T>[]): Promise<T> {
            capturedChoices = choices;
            return '__cancel__' as T;
          },
        },
        loadConfig: async () => config,
        logger: createSilentLogger(),
      },
    );

    const skillChoice = capturedChoices.find((choice) => choice.value === 'npm-pkg-expert');
    assert.equal(skillChoice?.name.includes('  >'), false);
    assert.match(
      skillChoice?.name ?? '',
      /^npm-pkg-expert  Expert guide for building, maintaining, and pub\.\.\.$/,
    );
  });

  test('createSkill skips authoring mode prompt with --mode flag', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];

    await createSkill(
      { name: 'agent-test', mode: 'skip' },
      {
        prompts: new PromptStub({}),
        loadConfig: async () => config,
        logger: createRecordingLogger(logs),
      },
    );

    const skillFilePath = path.join(config.localRegistryPath!, 'skills', 'agent-test', 'SKILL.md');
    await assert.doesNotReject(() => fs.access(skillFilePath));
    assert.match(logs.join('\n'), /Created skill "agent-test"/);
    assert.match(logs.join('\n'), /Skill created at/);
  });

  test('editSkill skips authoring mode prompt with --mode flag', async () => {
    const config = await createInitializedConfig();
    const openedFiles: string[] = [];
    await writeSkillFile(config, 'agent-edit-test');
    const skillDirectory = path.join(config.localRegistryPath!, 'skills', 'agent-edit-test');

    await editSkill(
      { name: 'agent-edit-test', mode: 'open-vscode' },
      {
        prompts: new PromptStub({}),
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createSilentLogger(),
      },
    );

    assert.deepEqual(openedFiles, [skillDirectory]);
  });

  test('removeSkill skips confirmation with --yes flag', async () => {
    const config = await createInitializedConfig();
    await writeSkillFile(config, 'to-remove');

    let confirmCalled = false;

    const removed = await removeSkill(
      { name: 'to-remove', yes: true },
      {
        loadConfig: async () => config,
        prompts: {
          async input() {
            throw new Error('should not be called');
          },
          async confirm() {
            confirmCalled = true;
            return false;
          },
          async search() {
            throw new Error('should not be called');
          },
          async select() {
            throw new Error('should not be called');
          },
        },
        logger: createSilentLogger(),
      },
    );

    assert.equal(removed, 'to-remove');
    assert.equal(confirmCalled, false);
  });

  test('removeSkill auto-pushes with --push flag', async () => {
    const config = await createInitializedConfig();
    let pushMessage: string | undefined;
    await writeSkillFile(config, 'push-test');

    const removed = await removeSkill(
      { name: 'push-test', yes: true, push: true },
      {
        loadConfig: async () => config,
        prompts: new PromptStub({}),
        logger: createSilentLogger(),
        pushToRemote: async (message: string) => {
          pushMessage = message;
          return true;
        },
      },
    );

    assert.equal(removed, 'push-test');
    assert.match(pushMessage!, /remove skill "push-test"/);
  });

  test('removeSkill surfaces remote push failures when remote removal is selected', async () => {
    const config = await createInitializedConfig();
    await writeSkillFile(config, 'push-fails');

    await assert.rejects(
      () =>
        removeSkill(
          { name: 'push-fails', yes: true, push: true },
          {
            loadConfig: async () => config,
            prompts: new PromptStub({}),
            logger: createSilentLogger(),
            pushToRemote: async () => {
              throw new Error('Push failed.');
            },
          },
        ),
      /Push failed\./,
    );
  });

  test('listSkills with --json outputs JSON and skips prompts', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    await writeSkillFile(
      config,
      'json-test',
      `---
name: json-test
description: A test skill
---

# JSON Test
`,
    );

    const skills = await listSkills(
      { json: true },
      {
        loadConfig: async () => config,
        logger: createRecordingLogger(logs),
      },
    );

    assert.equal(skills.length, 1);
    const output = JSON.parse(logs.join('\n'));
    assert.equal(output[0].name, 'json-test');
    assert.equal(output[0].description, 'A test skill');
    assert.equal(output[0].valid, true);
  });

  test('listSkills with --json shows empty array when no skills', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];

    const skills = await listSkills(
      { json: true },
      {
        loadConfig: async () => config,
        logger: createRecordingLogger(logs),
      },
    );

    assert.deepEqual(skills, []);
    assert.equal(logs[0], '[]');
  });
});
