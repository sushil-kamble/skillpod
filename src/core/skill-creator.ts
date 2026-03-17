import { spawn } from 'node:child_process';

import { getErrorMessage } from '../utils/errors.js';

export const SKILL_CREATOR_NAME = 'skill-creator';
export const SKILL_CREATOR_SOURCE = 'https://github.com/anthropics/skills';
export const SUPPORTED_SKILL_CREATOR_AGENTS = ['claude-code', 'opencode', 'codex'] as const;

type SkillCreatorAgent = (typeof SUPPORTED_SKILL_CREATOR_AGENTS)[number];

export interface SkillCreatorAvailability {
  availableAgents: SkillCreatorAgent[];
  missingAgents: SkillCreatorAgent[];
  unverifiedAgents: SkillCreatorAgent[];
}

export interface SkillCreatorRunner {
  run(
    command: string,
    args: string[],
    options?: {
      stdio?: 'inherit' | 'pipe';
    },
  ): Promise<{ stdout: string }>;
}

export interface SkillCreatorService {
  buildCreatePrompt(skillName: string, skillDirectory: string): string;
  buildDoctorDetail(availability: SkillCreatorAvailability): string;
  buildEditPrompt(skillName: string, skillDirectory: string): string;
  detectAvailability(): Promise<SkillCreatorAvailability>;
  getInstallCommand(): string;
  install(): Promise<void>;
}

const skillCreatorRunner: SkillCreatorRunner = {
  async run(
    command: string,
    args: string[],
    options?: {
      stdio?: 'inherit' | 'pipe';
    },
  ): Promise<{ stdout: string }> {
    const stdio = options?.stdio ?? 'pipe';

    return new Promise<{ stdout: string }>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: stdio === 'inherit' ? 'inherit' : 'pipe',
      });

      let stdout = '';
      let stderr = '';
      const captureOutput = stdio === 'pipe';

      if (captureOutput) {
        child.stdout?.on('data', (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });

        child.stderr?.on('data', (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });
      }

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve({ stdout });
          return;
        }

        const detail = stderr.trim() || stdout.trim();
        reject(
          new Error(
            detail.length > 0
              ? `The command exited with code ${code ?? 'unknown'}. ${detail}`
              : `The command exited with code ${code ?? 'unknown'}.`,
          ),
        );
      });
    });
  },
};

// Matches ESC[ followed by parameter bytes (0-9 ;) and a final byte
const ANSI_ESCAPE_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_ESCAPE_RE, '');
}

function outputContainsSkillCreator(output: string): boolean {
  return stripAnsi(output)
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === SKILL_CREATOR_NAME || line.startsWith(`${SKILL_CREATOR_NAME} `));
}

function formatAgents(agents: readonly string[]): string {
  return agents.join(', ');
}

function buildSkillCreatorListArgs(agent: SkillCreatorAgent): string[] {
  return ['skills', 'ls', '-g', '-a', agent];
}

function buildSkillCreatorInstallArgs(): string[] {
  return [
    'skills',
    'add',
    SKILL_CREATOR_SOURCE,
    '--skill',
    SKILL_CREATOR_NAME,
    '-g',
    ...SUPPORTED_SKILL_CREATOR_AGENTS.flatMap((agent) => ['-a', agent]),
  ];
}

function getInstallCommand(): string {
  return `npx ${buildSkillCreatorInstallArgs().join(' ')}`;
}

function createPromptHeader(skillDirectory: string): string {
  return [
    `Please use the installed \`${SKILL_CREATOR_NAME}\` skill.`,
    `Work only inside this directory: ${skillDirectory}`,
  ].join('\n');
}

export function createSkillCreatorService(
  runner: SkillCreatorRunner = skillCreatorRunner,
): SkillCreatorService {
  return {
    buildCreatePrompt(skillName: string, skillDirectory: string): string {
      return [
        createPromptHeader(skillDirectory),
        `Create or refine a skill package named \`${skillName}\`.`,
        'Create or improve `SKILL.md`, optional reference markdown files, and optional scripts only inside this directory.',
        `Ensure \`SKILL.md\` has valid YAML frontmatter with \`name: ${skillName}\` and a non-empty \`description\`.`,
        'Do not modify files outside this skill directory.',
      ].join('\n');
    },

    buildDoctorDetail(availability: SkillCreatorAvailability): string {
      if (availability.availableAgents.length > 0) {
        return `Installed for ${formatAgents(availability.availableAgents)}.`;
      }

      const details: string[] = [];

      if (availability.missingAgents.length > 0) {
        details.push(`missing for ${formatAgents(availability.missingAgents)}`);
      }

      if (availability.unverifiedAgents.length > 0) {
        details.push(`unverified for ${formatAgents(availability.unverifiedAgents)}`);
      }

      const prefix = details.length > 0 ? `${details.join('; ')}. ` : '';

      return `${prefix}Recommended install: ${getInstallCommand()}`;
    },

    buildEditPrompt(skillName: string, skillDirectory: string): string {
      return [
        createPromptHeader(skillDirectory),
        `Review and improve the existing \`${skillName}\` skill package in place.`,
        'Preserve the current skill name and frontmatter unless you are intentionally correcting invalid metadata.',
        'You may refine `SKILL.md`, add supporting markdown reference files, and add scripts if they improve the package.',
        'Keep all changes scoped to this directory and ensure `SKILL.md` still has a valid `name` and a non-empty `description`.',
      ].join('\n');
    },

    async detectAvailability(): Promise<SkillCreatorAvailability> {
      const results = await Promise.allSettled(
        SUPPORTED_SKILL_CREATOR_AGENTS.map(async (agent) => ({
          agent,
          result: await runner.run('npx', buildSkillCreatorListArgs(agent), { stdio: 'pipe' }),
        })),
      );

      const availableAgents: SkillCreatorAgent[] = [];
      const missingAgents: SkillCreatorAgent[] = [];
      const unverifiedAgents: SkillCreatorAgent[] = [];

      results.forEach((result, index) => {
        const agent = SUPPORTED_SKILL_CREATOR_AGENTS[index];

        if (!agent) {
          return;
        }

        if (result.status === 'rejected') {
          unverifiedAgents.push(agent);
          return;
        }

        if (outputContainsSkillCreator(result.value.result.stdout)) {
          availableAgents.push(agent);
          return;
        }

        missingAgents.push(agent);
      });

      return {
        availableAgents,
        missingAgents,
        unverifiedAgents,
      };
    },

    getInstallCommand,

    async install(): Promise<void> {
      try {
        await runner.run('npx', buildSkillCreatorInstallArgs(), { stdio: 'inherit' });
      } catch (error) {
        const command = getInstallCommand();
        throw new Error(
          `Failed to install ${SKILL_CREATOR_NAME}. Try "${command}". ${getErrorMessage(error)}`,
        );
      }
    },
  };
}

export const skillCreatorService = createSkillCreatorService();

export const skillCreatorInternals = {
  buildSkillCreatorInstallArgs,
  buildSkillCreatorListArgs,
  getInstallCommand,
  outputContainsSkillCreator,
};
