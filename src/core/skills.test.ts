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
} from './skills.js';
import type { SkillForgeConfig } from '../types/config.js';
import type { EditorService } from '../utils/editor.js';
import { createRecordingLogger, createSilentLogger, createTempDirTracker } from '../test-utils/shared.js';

afterEach(async () => {
  await tempDirTracker.cleanup();
});

const tempDirTracker = createTempDirTracker();
const { makeTempDir } = tempDirTracker;

async function createInitializedConfig(): Promise<SkillForgeConfig> {
  const root = await makeTempDir('skill-forge-skills-');
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
    },
  ) {}

  private nextResponse<K extends keyof PromptStub['responses']>(key: K): NonNullable<PromptStub['responses'][K]>[number] {
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

async function writeSkillFile(
  config: SkillForgeConfig,
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
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createSilentLogger(),
      },
    );

    const skillFilePath = path.join(config.localRegistryPath!, 'skills', 'fastapi-structure', 'SKILL.md');
    const content = await fs.readFile(skillFilePath, 'utf8');

    assert.match(content, /^---\nname: fastapi-structure\n/);
    assert.match(content, /description:\n  \[Describe what this skill does/);
    assert.deepEqual(openedFiles, [skillFilePath]);
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

  test('listSkills shows created skills with name and parsed description', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
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

    const skills = await listSkills({
      loadConfig: async () => config,
      logger: createRecordingLogger(logs),
    });

    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.name, 'fastapi-structure');
    assert.equal(skills[0]?.description, 'Build a clean FastAPI project structure for backend services.');
    assert.match(logs[0] ?? '', /fastapi-structure/);
  });

  test('listSkills creates a missing skills directory and shows the empty state', async () => {
    const config = await createInitializedConfig();
    const logs: string[] = [];
    await fs.rm(path.join(config.localRegistryPath!, 'skills'), { recursive: true, force: true });

    const skills = await listSkills({
      loadConfig: async () => config,
      logger: createRecordingLogger(logs),
    });

    assert.deepEqual(skills, []);
    await assert.doesNotReject(() => fs.access(path.join(config.localRegistryPath!, 'skills')));
    assert.equal(logs[0], skillsInternals.EMPTY_STATE_MESSAGE);
  });

  test('editSkill opens the requested skill directory in the editor', async () => {
    const config = await createInitializedConfig();
    const openedFiles: string[] = [];
    await writeSkillFile(config, 'fastapi-structure');
    const skillDirectory = path.join(config.localRegistryPath!, 'skills', 'fastapi-structure');

    await editSkill(
      { name: 'fastapi-structure' },
      {
        loadConfig: async () => config,
        editor: createEditorStub(openedFiles),
        logger: createSilentLogger(),
      },
    );

    assert.deepEqual(openedFiles, [skillDirectory]);
  });

  test('removeSkill confirms before deleting the skill directory', async () => {
    const config = await createInitializedConfig();
    const skillFilePath = await writeSkillFile(config, 'fastapi-structure');

    const removed = await removeSkill(
      { name: 'fastapi-structure' },
      {
        loadConfig: async () => config,
        prompts: new PromptStub({ confirm: [true] }),
        logger: createSilentLogger(),
      },
    );

    assert.equal(removed, 'fastapi-structure');
    await assert.rejects(() => fs.access(skillFilePath));
  });

  test('removeSkill shows a clear error when the skill does not exist', async () => {
    const config = await createInitializedConfig();

    await assert.rejects(
      () =>
        removeSkill(
          { name: 'nonexistent' },
          {
            loadConfig: async () => config,
            prompts: new PromptStub({}),
            logger: createSilentLogger(),
          },
        ),
      /Skill "nonexistent" not found\./,
    );
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

    const skills = await listSkills({
      loadConfig: async () => config,
      logger: createSilentLogger(),
    });

    assert.equal(skills[0]?.valid, false);
    assert.equal(skills[0]?.description, skillsInternals.DESCRIPTION_FALLBACK);
  });
});
