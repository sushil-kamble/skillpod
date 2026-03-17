import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SKILL_CREATOR_SOURCE,
  SUPPORTED_SKILL_CREATOR_AGENTS,
  createSkillCreatorService,
  skillCreatorInternals,
} from './skill-creator.js';

test('detectAvailability reports installed and missing agents from skills ls output', async () => {
  const service = createSkillCreatorService({
    async run(_command, args) {
      const agent = args[args.length - 1];

      if (agent === 'claude-code' || agent === 'codex') {
        return { stdout: 'skill-creator\nother-skill\n' };
      }

      return { stdout: 'other-skill\n' };
    },
  });

  const availability = await service.detectAvailability();

  assert.deepEqual(availability.availableAgents, ['claude-code', 'codex']);
  assert.deepEqual(availability.missingAgents, ['opencode']);
  assert.deepEqual(availability.unverifiedAgents, []);
});

test('detectAvailability marks agents as unverified when skills ls fails', async () => {
  const service = createSkillCreatorService({
    async run() {
      throw new Error('network');
    },
  });

  const availability = await service.detectAvailability();

  assert.deepEqual(availability.availableAgents, []);
  assert.deepEqual(availability.missingAgents, []);
  assert.deepEqual(availability.unverifiedAgents, [...SUPPORTED_SKILL_CREATOR_AGENTS]);
});

test('install uses the canonical anthropics skills command for all supported agents', async () => {
  const calls: Array<{ command: string; args: string[]; stdio?: string }> = [];
  const service = createSkillCreatorService({
    async run(command, args, options) {
      calls.push({ command, args, stdio: options?.stdio });
      return { stdout: '' };
    },
  });

  await service.install();

  assert.deepEqual(calls, [
    {
      command: 'npx',
      args: [
        'skills',
        'add',
        SKILL_CREATOR_SOURCE,
        '--skill',
        'skill-creator',
        '-g',
        '-a',
        'claude-code',
        '-a',
        'opencode',
        '-a',
        'codex',
      ],
      stdio: 'inherit',
    },
  ]);
  assert.equal(
    service.getInstallCommand(),
    'npx skills add https://github.com/anthropics/skills --skill skill-creator -g -a claude-code -a opencode -a codex',
  );
});

test('build prompts include the skill name and target directory', () => {
  const service = createSkillCreatorService({
    async run() {
      return { stdout: '' };
    },
  });

  const createPrompt = service.buildCreatePrompt(
    'fastapi-best-practices',
    '/tmp/skills/fastapi-best-practices',
  );
  const editPrompt = service.buildEditPrompt(
    'fastapi-best-practices',
    '/tmp/skills/fastapi-best-practices',
  );

  assert.match(createPrompt, /fastapi-best-practices/);
  assert.match(
    createPrompt,
    /Work only inside this directory: \/tmp\/skills\/fastapi-best-practices/,
  );
  assert.doesNotMatch(createPrompt, /Paste this into your AI agent/);
  assert.match(
    editPrompt,
    /Review and improve the existing `fastapi-best-practices` skill package/,
  );
});

test('doctor detail shows installed agents without install command when available for some', () => {
  const service = createSkillCreatorService({
    async run() {
      return { stdout: '' };
    },
  });

  const detail = service.buildDoctorDetail({
    availableAgents: ['claude-code'],
    missingAgents: ['opencode'],
    unverifiedAgents: ['codex'],
  });

  assert.match(detail, /Installed for claude-code/);
  assert.doesNotMatch(
    detail,
    new RegExp(skillCreatorInternals.getInstallCommand().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
});

test('doctor detail includes the recommended install command when not installed for any agent', () => {
  const service = createSkillCreatorService({
    async run() {
      return { stdout: '' };
    },
  });

  const detail = service.buildDoctorDetail({
    availableAgents: [],
    missingAgents: ['claude-code', 'opencode'],
    unverifiedAgents: ['codex'],
  });

  assert.match(detail, /missing for claude-code, opencode/);
  assert.match(detail, /unverified for codex/);
  assert.match(
    detail,
    new RegExp(skillCreatorInternals.getInstallCommand().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
});

test('outputContainsSkillCreator detects skill-creator in ANSI-colored output', () => {
  // Simulates real `npx skills ls` output with ANSI color codes
  const ansiOutput =
    '\x1B[1mGlobal Skills\x1B[0m\n\n  \x1B[36mskill-creator\x1B[0m \x1B[38;5;102m~/.agents/skills/skill-creator\x1B[0m\n';
  const service = createSkillCreatorService({
    async run() {
      return { stdout: ansiOutput };
    },
  });

  // Indirectly verify via detectAvailability
  return service.detectAvailability().then((availability) => {
    assert.deepEqual(availability.availableAgents, ['claude-code', 'opencode', 'codex']);
    assert.deepEqual(availability.missingAgents, []);
  });
});
