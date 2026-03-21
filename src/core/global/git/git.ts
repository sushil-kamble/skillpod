import { promises as fs } from 'node:fs';
import path from 'node:path';

import { simpleGit } from 'simple-git';

import { pathExists } from '#utils/io/filesystem.js';

export interface GitService {
  pathExists(targetPath: string): Promise<boolean>;
  isGitRepository(targetPath: string): Promise<boolean>;
  removeDirectory(targetPath: string): Promise<void>;
  cloneRepository(repoUrl: string, targetPath: string): Promise<void>;
  ensureSkillsDirectory(targetPath: string, githubUsername: string): Promise<boolean>;
}

async function removeDirectory(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function isGitRepository(targetPath: string): Promise<boolean> {
  return pathExists(path.join(targetPath, '.git'));
}

async function cloneRepository(repoUrl: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await simpleGit().clone(repoUrl, targetPath);
}

async function ensureSkillsDirectory(targetPath: string, githubUsername: string): Promise<boolean> {
  const skillsDirectory = path.join(targetPath, 'skills');

  if (await pathExists(skillsDirectory)) {
    return false;
  }

  await fs.mkdir(skillsDirectory, { recursive: true });
  await fs.writeFile(path.join(skillsDirectory, '.gitkeep'), '', 'utf8');

  const git = simpleGit(targetPath);
  await git.addConfig('user.name', githubUsername, false, 'local');
  await git.addConfig('user.email', `${githubUsername}@users.noreply.github.com`, false, 'local');
  await git.add('skills/.gitkeep');
  await git.commit('chore: initialize skills directory');

  return true;
}

export const gitService: GitService = {
  pathExists,
  isGitRepository,
  removeDirectory,
  cloneRepository,
  ensureSkillsDirectory,
};
