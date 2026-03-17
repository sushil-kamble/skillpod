import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { box, formatBoxTable, formatChangeSummary, formatDoctorCheck, stepLabel } from './ui.js';
import type { DoctorCheck } from '../core/doctor.js';

describe('ui utilities', () => {
  describe('box', () => {
    test('wraps single-line content in a Unicode box', () => {
      const result = box('Hello');
      const lines = result.split('\n');

      assert.equal(lines.length, 3);
      assert.match(lines[0]!, /^┌─+┐$/);
      assert.match(lines[1]!, /^│ Hello │$/);
      assert.match(lines[2]!, /^└─+┘$/);
    });

    test('wraps multi-line content with consistent width', () => {
      const result = box('Short\nA longer line');
      const lines = result.split('\n');

      assert.equal(lines.length, 4);
      assert.match(lines[1]!, /^│ Short\s+│$/);
      assert.match(lines[2]!, /^│ A longer line │$/);
    });
  });

  describe('stepLabel', () => {
    test('formats step indicator with label', () => {
      const result = stepLabel(1, 4, 'Validating token...');
      assert.ok(result.includes('Step 1/4'));
      assert.ok(result.includes('Validating token...'));
    });
  });

  describe('formatBoxTable', () => {
    test('formats a table with box-drawing characters', () => {
      const result = formatBoxTable(
        ['Name', 'Description'],
        [
          ['my-skill', 'Does something cool'],
          ['other', 'Another skill'],
        ],
      );
      const lines = result.split('\n');

      assert.match(lines[0]!, /^┌─+┬─+┐$/);
      assert.match(lines[1]!, /^│.*Name.*│.*Description.*│$/);
      assert.match(lines[2]!, /^├─+┼─+┤$/);
      assert.match(lines[3]!, /^│.*my-skill.*│.*Does something cool.*│$/);
      assert.match(lines[4]!, /^│.*other.*│.*Another skill.*│$/);
      assert.match(lines[5]!, /^└─+┴─+┘$/);
    });

    test('handles empty rows', () => {
      const result = formatBoxTable(['Name'], []);
      const lines = result.split('\n');

      assert.equal(lines.length, 4);
      assert.match(lines[0]!, /^┌─+┐$/);
      assert.match(lines[3]!, /^└─+┘$/);
    });
  });

  describe('formatChangeSummary', () => {
    test('formats all change types with icons', () => {
      const result = formatChangeSummary(
        {
          added: ['new-skill'],
          modified: ['existing-skill'],
          removed: ['old-skill'],
        },
        'Changes:',
      );

      assert.ok(result.includes('Changes:'));
      assert.ok(result.includes('Added'));
      assert.ok(result.includes('new-skill'));
      assert.ok(result.includes('Modified'));
      assert.ok(result.includes('existing-skill'));
      assert.ok(result.includes('Removed'));
      assert.ok(result.includes('old-skill'));
    });

    test('omits empty categories', () => {
      const result = formatChangeSummary(
        {
          added: ['new-skill'],
          modified: [],
          removed: [],
        },
        'Changes:',
      );

      assert.ok(result.includes('Added'));
      assert.ok(!result.includes('Modified'));
      assert.ok(!result.includes('Removed'));
    });
  });

  describe('formatDoctorCheck', () => {
    test('formats pass checks with success icon', () => {
      const check: DoctorCheck = { label: 'Config', detail: 'Valid', status: 'pass' };
      const result = formatDoctorCheck(check);
      assert.ok(result.includes('PASS'));
      assert.ok(result.includes('Config'));
      assert.ok(result.includes('Valid'));
    });

    test('formats fail checks with error icon', () => {
      const check: DoctorCheck = { label: 'Config', detail: 'Missing', status: 'fail' };
      const result = formatDoctorCheck(check);
      assert.ok(result.includes('FAIL'));
    });

    test('formats recommended checks with warning icon', () => {
      const check: DoctorCheck = {
        label: 'skill-creator',
        detail: 'Not installed',
        status: 'recommended',
      };
      const result = formatDoctorCheck(check);
      assert.ok(result.includes('RECOMMENDED'));
    });

    test('formats unreachable checks with info icon', () => {
      const check: DoctorCheck = {
        label: 'GitHub',
        detail: 'Timed out',
        status: 'unreachable',
      };
      const result = formatDoctorCheck(check);
      assert.ok(result.includes('UNREACHABLE'));
    });
  });
});
