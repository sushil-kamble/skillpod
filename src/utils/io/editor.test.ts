import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorService } from '#utils/io/editor.js';

test('editor service prefers code over EDITOR when both are available', async () => {
  const launches: Array<{ command: string; filePath: string }> = [];
  const editor = createEditorService({
    env: {
      EDITOR: 'vim',
    },
    launchEditor: async (command, filePath) => {
      launches.push({ command, filePath });
    },
    resolveExecutable: async (command) => {
      if (command === 'code') {
        return '/usr/bin/code';
      }

      if (command === 'vim') {
        return '/usr/bin/vim';
      }

      return null;
    },
  });

  const result = await editor.open('/tmp/skill-directory', {
    fallbackFilePath: '/tmp/skill-directory/SKILL.md',
    preferDirectory: true,
  });

  assert.deepEqual(launches, [{ command: '/usr/bin/code', filePath: '/tmp/skill-directory' }]);
  assert.equal(result.targetPath, '/tmp/skill-directory');
});

test('editor service falls back to the skill file for terminal editors', async () => {
  const launches: Array<{ command: string; filePath: string }> = [];
  const editor = createEditorService({
    env: {
      EDITOR: 'nano',
    },
    launchEditor: async (command, filePath) => {
      launches.push({ command, filePath });
    },
    resolveExecutable: async (command) => {
      if (command === 'nano') {
        return '/usr/bin/nano';
      }

      return null;
    },
  });

  const result = await editor.open('/tmp/skill-directory', {
    fallbackFilePath: '/tmp/skill-directory/SKILL.md',
    preferDirectory: true,
  });

  assert.deepEqual(launches, [{ command: 'nano', filePath: '/tmp/skill-directory/SKILL.md' }]);
  assert.equal(result.targetPath, '/tmp/skill-directory/SKILL.md');
});
