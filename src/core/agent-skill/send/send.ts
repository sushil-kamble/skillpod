import { promises as fs } from 'node:fs';
import path from 'node:path';

import { loadConfig } from '#core/global/config/config.js';
import { ensureInitializedRegistryPath } from '#core/global/registry-path/registry-path.js';
import { pullRegistry, pushRegistry } from '#core/agent-skill/registry-git/registry-git.js';
import { skillsInternals } from '#core/agent-skill/skills/skills.js';
import { pathExists } from '#utils/io/filesystem.js';
import { logger, type Logger } from '#utils/logging/logger.js';
import type { SkillPodConfig } from '#types/config.js';
import type { RegistryGitDependencies } from '#core/agent-skill/registry-git/registry-git.js';

export interface SendSkillOptions {
  path: string;
  force?: boolean;
}

export interface SendDependencies {
  loadConfig?: () => Promise<SkillPodConfig>;
  logger?: Logger;
  readFile?: (filePath: string) => Promise<string>;
  copyDirectory?: (source: string, destination: string) => Promise<void>;
  checkExists?: (targetPath: string) => Promise<boolean>;
  registryGit?: RegistryGitDependencies;
  pullRegistry?: (
    options: { all?: boolean },
    dependencies?: RegistryGitDependencies,
  ) => Promise<unknown>;
  pushRegistry?: (
    options: { skill?: string },
    dependencies?: RegistryGitDependencies,
  ) => Promise<unknown>;
}

export interface SendResult {
  status: 'sent' | 'aborted';
  skillName?: string | undefined;
}

async function copyDirectoryRecursive(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });

  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, destinationPath);
    } else {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

function resolveSkillName(frontmatterName: string | null, directoryPath: string): string {
  if (frontmatterName) {
    return frontmatterName;
  }

  return path.basename(directoryPath);
}

export async function sendSkill(
  options: SendSkillOptions,
  dependencies: SendDependencies = {},
): Promise<SendResult> {
  const log = dependencies.logger ?? logger;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const readFile = dependencies.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const copyDir = dependencies.copyDirectory ?? copyDirectoryRecursive;
  const checkExists = dependencies.checkExists ?? pathExists;
  const doPull = dependencies.pullRegistry ?? pullRegistry;
  const doPush = dependencies.pushRegistry ?? pushRegistry;

  const sourcePath = path.resolve(options.path);
  const skillMdPath = path.join(sourcePath, 'SKILL.md');

  if (!(await checkExists(sourcePath))) {
    throw new Error(`Path not found: ${sourcePath}`);
  }

  if (!(await checkExists(skillMdPath))) {
    throw new Error(
      `No SKILL.md found in ${sourcePath}. A valid skill directory must contain a SKILL.md file.`,
    );
  }

  const content = await readFile(skillMdPath);
  const frontmatter = skillsInternals.parseFrontmatter(content);

  if (!frontmatter.name) {
    throw new Error(
      'SKILL.md is missing a "name" field in the frontmatter. Expected format:\n\n---\nname: my-skill\ndescription: What this skill does\n---',
    );
  }

  if (!frontmatter.description) {
    throw new Error(
      'SKILL.md is missing a "description" field in the frontmatter. Expected format:\n\n---\nname: my-skill\ndescription: What this skill does\n---',
    );
  }

  const skillName = resolveSkillName(frontmatter.name, sourcePath);

  const nameError = skillsInternals.validateSkillName(skillName);
  if (nameError) {
    throw new Error(`Invalid skill name "${skillName}". ${nameError}`);
  }

  const config = await readConfig();
  const localRegistryPath = ensureInitializedRegistryPath(config);
  const destinationPath = path.join(localRegistryPath, 'skills', skillName);

  if (await checkExists(destinationPath)) {
    if (!options.force) {
      throw new Error(
        `Skill "${skillName}" already exists in the local registry. Use --force to overwrite.`,
      );
    }

    log.info(`Overwriting existing skill "${skillName}" in the local registry.`);
  }

  log.info('Pulling latest changes from remote...');
  await doPull({ all: true }, dependencies.registryGit);

  await copyDir(sourcePath, destinationPath);
  log.success(`Skill "${skillName}" copied to registry.`);

  log.info('Pushing to remote...');
  await doPush({ skill: skillName }, dependencies.registryGit);

  log.success(`Skill "${skillName}" sent successfully.`);

  return {
    status: 'sent',
    skillName,
  };
}

export const sendInternals = {
  copyDirectoryRecursive,
  resolveSkillName,
};
