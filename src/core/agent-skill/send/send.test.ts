import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { sendSkill, sendInternals } from '#core/agent-skill/send/send.js';
import { createRecordingLogger, createTempDirTracker } from '#test-utils/shared.js';
import type { SkillPodConfig } from '#types/config.js';

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

function createConfig(localRegistryPath: string): SkillPodConfig {
  return {
    githubToken: 'token',
    githubUsername: 'octocat',
    registryRepoUrl: 'https://github.com/octocat/skills',
    localRegistryPath,
    registryRepoName: 'skills',
  };
}

const VALID_SKILL_MD = `---
name: my-skill
description: A skill that does something useful
---

# My Skill

Instructions here.
`;

const SKILL_MD_NO_NAME = `---
description: A skill that does something
---

# No Name Skill
`;

const SKILL_MD_NO_DESCRIPTION = `---
name: my-skill
---

# My Skill
`;

const SKILL_MD_BLOCK_DESCRIPTION = `---
name: pdf-processing
description:
  Extract text and tables from PDF files, fill forms, merge documents.
  Use when working with PDF files.
---

# PDF Processing
`;

async function createSkillSource(
  baseDir: string,
  skillName: string,
  skillMd: string,
  extraFiles: Record<string, string> = {},
): Promise<string> {
  const skillDir = path.join(baseDir, skillName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMd, 'utf8');

  for (const [fileName, content] of Object.entries(extraFiles)) {
    const filePath = path.join(skillDir, fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  return skillDir;
}

function createNoopRegistryOps(): {
  pullCalls: Array<{ options: unknown }>;
  pushCalls: Array<{ options: unknown }>;
  pullRegistry: (options: { all?: boolean }) => Promise<unknown>;
  pushRegistry: (options: { skill?: string }) => Promise<unknown>;
} {
  const pullCalls: Array<{ options: unknown }> = [];
  const pushCalls: Array<{ options: unknown }> = [];

  return {
    pullCalls,
    pushCalls,
    async pullRegistry(options) {
      pullCalls.push({ options });
      return { status: 'pulled' };
    },
    async pushRegistry(options) {
      pushCalls.push({ options });
      return { status: 'pushed' };
    },
  };
}

describe('sendSkill', () => {
  test('sends a valid skill to the registry', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-source-');
    const registryDir = await tempDirs.makeTempDir('send-registry-');
    const skillPath = await createSkillSource(sourceDir, 'my-skill', VALID_SKILL_MD);
    const registryOps = createNoopRegistryOps();

    const result = await sendSkill(
      { path: skillPath },
      {
        loadConfig: async () => createConfig(registryDir),
        logger: createRecordingLogger(),
        pullRegistry: registryOps.pullRegistry,
        pushRegistry: registryOps.pushRegistry,
      },
    );

    assert.equal(result.status, 'sent');
    assert.equal(result.skillName, 'my-skill');

    const copiedSkillMd = await fs.readFile(
      path.join(registryDir, 'skills', 'my-skill', 'SKILL.md'),
      'utf8',
    );
    assert.equal(copiedSkillMd, VALID_SKILL_MD);
  });

  test('copies the entire directory including extra files', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-full-');
    const registryDir = await tempDirs.makeTempDir('send-registry-');
    const skillPath = await createSkillSource(sourceDir, 'my-skill', VALID_SKILL_MD, {
      'reference.md': '# Reference docs',
      'examples/example.ts': 'console.log("hello");',
    });
    const registryOps = createNoopRegistryOps();

    await sendSkill(
      { path: skillPath },
      {
        loadConfig: async () => createConfig(registryDir),
        logger: createRecordingLogger(),
        pullRegistry: registryOps.pullRegistry,
        pushRegistry: registryOps.pushRegistry,
      },
    );

    const refContent = await fs.readFile(
      path.join(registryDir, 'skills', 'my-skill', 'reference.md'),
      'utf8',
    );
    assert.equal(refContent, '# Reference docs');

    const exampleContent = await fs.readFile(
      path.join(registryDir, 'skills', 'my-skill', 'examples', 'example.ts'),
      'utf8',
    );
    assert.equal(exampleContent, 'console.log("hello");');
  });

  test('throws when source path does not exist', async () => {
    await assert.rejects(
      () =>
        sendSkill(
          { path: '/nonexistent/path' },
          {
            loadConfig: async () => createConfig('/tmp/registry'),
            logger: createRecordingLogger(),
          },
        ),
      /Path not found/,
    );
  });

  test('throws when SKILL.md does not exist in directory', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-no-skill-');
    const emptySkillDir = path.join(sourceDir, 'empty-skill');
    await fs.mkdir(emptySkillDir, { recursive: true });
    await fs.writeFile(path.join(emptySkillDir, 'README.md'), '# Not a skill', 'utf8');

    await assert.rejects(
      () =>
        sendSkill(
          { path: emptySkillDir },
          {
            loadConfig: async () => createConfig('/tmp/registry'),
            logger: createRecordingLogger(),
          },
        ),
      /No SKILL\.md found/,
    );
  });

  test('throws when SKILL.md is missing name field', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-no-name-');
    const skillPath = await createSkillSource(sourceDir, 'bad-skill', SKILL_MD_NO_NAME);

    await assert.rejects(
      () =>
        sendSkill(
          { path: skillPath },
          {
            loadConfig: async () => createConfig('/tmp/registry'),
            logger: createRecordingLogger(),
          },
        ),
      /missing a "name" field/,
    );
  });

  test('throws when SKILL.md is missing description field', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-no-desc-');
    const skillPath = await createSkillSource(sourceDir, 'bad-skill', SKILL_MD_NO_DESCRIPTION);

    await assert.rejects(
      () =>
        sendSkill(
          { path: skillPath },
          {
            loadConfig: async () => createConfig('/tmp/registry'),
            logger: createRecordingLogger(),
          },
        ),
      /missing a "description" field/,
    );
  });

  test('accepts block-style description in frontmatter', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-block-');
    const registryDir = await tempDirs.makeTempDir('send-registry-');
    const skillPath = await createSkillSource(
      sourceDir,
      'pdf-processing',
      SKILL_MD_BLOCK_DESCRIPTION,
    );
    const registryOps = createNoopRegistryOps();

    const result = await sendSkill(
      { path: skillPath },
      {
        loadConfig: async () => createConfig(registryDir),
        logger: createRecordingLogger(),
        pullRegistry: registryOps.pullRegistry,
        pushRegistry: registryOps.pushRegistry,
      },
    );

    assert.equal(result.status, 'sent');
    assert.equal(result.skillName, 'pdf-processing');
  });

  test('throws when skill already exists without --force', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-dup-');
    const registryDir = await tempDirs.makeTempDir('send-registry-');
    const skillPath = await createSkillSource(sourceDir, 'my-skill', VALID_SKILL_MD);

    const existingDir = path.join(registryDir, 'skills', 'my-skill');
    await fs.mkdir(existingDir, { recursive: true });
    await fs.writeFile(path.join(existingDir, 'SKILL.md'), 'old content', 'utf8');

    await assert.rejects(
      () =>
        sendSkill(
          { path: skillPath },
          {
            loadConfig: async () => createConfig(registryDir),
            logger: createRecordingLogger(),
            pullRegistry: async () => ({ status: 'pulled' }),
            pushRegistry: async () => ({ status: 'pushed' }),
          },
        ),
      /already exists.*--force/,
    );
  });

  test('overwrites existing skill with --force', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-force-');
    const registryDir = await tempDirs.makeTempDir('send-registry-');
    const skillPath = await createSkillSource(sourceDir, 'my-skill', VALID_SKILL_MD);
    const registryOps = createNoopRegistryOps();

    const existingDir = path.join(registryDir, 'skills', 'my-skill');
    await fs.mkdir(existingDir, { recursive: true });
    await fs.writeFile(path.join(existingDir, 'SKILL.md'), 'old content', 'utf8');

    const logs: string[] = [];
    const result = await sendSkill(
      { path: skillPath, force: true },
      {
        loadConfig: async () => createConfig(registryDir),
        logger: createRecordingLogger(logs),
        pullRegistry: registryOps.pullRegistry,
        pushRegistry: registryOps.pushRegistry,
      },
    );

    assert.equal(result.status, 'sent');
    assert.match(logs.join('\n'), /Overwriting/);

    const updatedContent = await fs.readFile(
      path.join(registryDir, 'skills', 'my-skill', 'SKILL.md'),
      'utf8',
    );
    assert.equal(updatedContent, VALID_SKILL_MD);
  });

  test('pulls before pushing', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-order-');
    const registryDir = await tempDirs.makeTempDir('send-registry-');
    const skillPath = await createSkillSource(sourceDir, 'my-skill', VALID_SKILL_MD);

    const callOrder: string[] = [];
    const result = await sendSkill(
      { path: skillPath },
      {
        loadConfig: async () => createConfig(registryDir),
        logger: createRecordingLogger(),
        async pullRegistry() {
          callOrder.push('pull');
          return { status: 'pulled' };
        },
        async pushRegistry() {
          callOrder.push('push');
          return { status: 'pushed' };
        },
      },
    );

    assert.equal(result.status, 'sent');
    assert.deepEqual(callOrder, ['pull', 'push']);
  });

  test('pushes the specific skill by name', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-push-');
    const registryDir = await tempDirs.makeTempDir('send-registry-');
    const skillPath = await createSkillSource(sourceDir, 'my-skill', VALID_SKILL_MD);
    const registryOps = createNoopRegistryOps();

    await sendSkill(
      { path: skillPath },
      {
        loadConfig: async () => createConfig(registryDir),
        logger: createRecordingLogger(),
        pullRegistry: registryOps.pullRegistry,
        pushRegistry: registryOps.pushRegistry,
      },
    );

    assert.equal(registryOps.pushCalls.length, 1);
    assert.deepEqual(registryOps.pushCalls[0]?.options, { skill: 'my-skill' });
  });

  test('pulls with --all flag', async () => {
    const sourceDir = await tempDirs.makeTempDir('send-pull-');
    const registryDir = await tempDirs.makeTempDir('send-registry-');
    const skillPath = await createSkillSource(sourceDir, 'my-skill', VALID_SKILL_MD);
    const registryOps = createNoopRegistryOps();

    await sendSkill(
      { path: skillPath },
      {
        loadConfig: async () => createConfig(registryDir),
        logger: createRecordingLogger(),
        pullRegistry: registryOps.pullRegistry,
        pushRegistry: registryOps.pushRegistry,
      },
    );

    assert.equal(registryOps.pullCalls.length, 1);
    assert.deepEqual(registryOps.pullCalls[0]?.options, { all: true });
  });

  test('falls back to directory name when frontmatter name is missing but description exists', async () => {
    const skillMd = `---
name: valid-name
description: Has a description
---

# Test
`;
    const sourceDir = await tempDirs.makeTempDir('send-fallback-');
    const registryDir = await tempDirs.makeTempDir('send-registry-');
    const skillPath = await createSkillSource(sourceDir, 'directory-name', skillMd);
    const registryOps = createNoopRegistryOps();

    const result = await sendSkill(
      { path: skillPath },
      {
        loadConfig: async () => createConfig(registryDir),
        logger: createRecordingLogger(),
        pullRegistry: registryOps.pullRegistry,
        pushRegistry: registryOps.pushRegistry,
      },
    );

    assert.equal(result.skillName, 'valid-name');
  });

  test('throws for invalid skill name format', async () => {
    const skillMd = `---
name: Invalid Name!
description: Has a description
---

# Test
`;
    const sourceDir = await tempDirs.makeTempDir('send-invalid-name-');
    const skillPath = await createSkillSource(sourceDir, 'invalid-source', skillMd);

    await assert.rejects(
      () =>
        sendSkill(
          { path: skillPath },
          {
            loadConfig: async () => createConfig('/tmp/registry'),
            logger: createRecordingLogger(),
          },
        ),
      /Invalid skill name/,
    );
  });
});

describe('sendInternals', () => {
  test('resolveSkillName uses frontmatter name when available', () => {
    assert.equal(sendInternals.resolveSkillName('my-skill', '/some/path/other-name'), 'my-skill');
  });

  test('resolveSkillName falls back to directory name', () => {
    assert.equal(sendInternals.resolveSkillName(null, '/some/path/dir-name'), 'dir-name');
  });

  test('copyDirectoryRecursive copies files and subdirectories', async () => {
    const sourceDir = await tempDirs.makeTempDir('copy-src-');
    const destDir = path.join(await tempDirs.makeTempDir('copy-dest-'), 'output');

    await fs.writeFile(path.join(sourceDir, 'file.txt'), 'hello', 'utf8');
    await fs.mkdir(path.join(sourceDir, 'sub'));
    await fs.writeFile(path.join(sourceDir, 'sub', 'nested.txt'), 'world', 'utf8');

    await sendInternals.copyDirectoryRecursive(sourceDir, destDir);

    const file = await fs.readFile(path.join(destDir, 'file.txt'), 'utf8');
    assert.equal(file, 'hello');

    const nested = await fs.readFile(path.join(destDir, 'sub', 'nested.txt'), 'utf8');
    assert.equal(nested, 'world');
  });
});
