import { Octokit } from 'octokit';

const REQUIRED_SCOPE = 'repo';
const GITHUB_HOST = 'github.com';

export interface ValidatedGitHubToken {
  githubToken: string;
  githubUsername: string;
  scopes: string[];
}

export interface RegistryRepository {
  cloneUrl: string;
  htmlUrl: string;
  owner: string;
  repo: string;
}

export interface RegistryRepositoryStatus {
  hasSkillsDirectory: boolean;
  isPrivate: boolean;
  repository: RegistryRepository;
}

export interface GitHubService {
  validateToken(token: string): Promise<ValidatedGitHubToken>;
  createSkillsRepository(token: string): Promise<RegistryRepository>;
  getRepository(token: string, repoUrl: string): Promise<RegistryRepository>;
  getRepositoryStatus(
    token: string,
    owner: string,
    repo: string,
  ): Promise<RegistryRepositoryStatus>;
  listRemoteSkills(token: string, owner: string, repo: string): Promise<string[]>;
}

class InvalidGitHubRepositoryUrlError extends Error {}
class InsufficientGitHubScopeError extends Error {}

interface GitHubRequestError extends Error {
  status?: number;
  response?: {
    headers: Record<string, string | undefined>;
  };
}

function getOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

function normalizeScopes(rawScopes: string | undefined): string[] {
  if (!rawScopes) {
    return [];
  }

  return rawScopes
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function parseGitHubRepoUrl(repoUrl: string): { owner: string; repo: string } {
  let url: URL;

  try {
    url = new URL(repoUrl);
  } catch {
    throw new InvalidGitHubRepositoryUrlError(
      'Repository URL must be a valid HTTPS GitHub URL, for example https://github.com/<owner>/<repo>.',
    );
  }

  if (url.protocol !== 'https:' || url.hostname !== GITHUB_HOST) {
    throw new InvalidGitHubRepositoryUrlError(
      'Repository URL must use HTTPS and point to github.com.',
    );
  }

  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length < 2) {
    throw new InvalidGitHubRepositoryUrlError(
      'Repository URL must include both owner and repository name.',
    );
  }

  const owner = segments[0];
  const rawRepo = segments[1];

  if (!owner || !rawRepo) {
    throw new InvalidGitHubRepositoryUrlError(
      'Repository URL must include both owner and repository name.',
    );
  }

  const repo = rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo;

  if (!owner || !repo) {
    throw new InvalidGitHubRepositoryUrlError(
      'Repository URL must include both owner and repository name.',
    );
  }

  return { owner, repo };
}

function toRegistryRepository(data: {
  clone_url: string;
  html_url: string;
  name: string;
  owner: { login: string };
}): RegistryRepository {
  return {
    cloneUrl: data.clone_url,
    htmlUrl: data.html_url,
    owner: data.owner.login,
    repo: data.name,
  };
}

async function fetchRepositoryData(
  token: string,
  owner: string,
  repo: string,
): Promise<{
  private: boolean;
  repository: RegistryRepository;
}> {
  const octokit = getOctokit(token);
  const repositoryResponse = await octokit.request('GET /repos/{owner}/{repo}', {
    owner,
    repo,
  });

  return {
    private: repositoryResponse.data.private,
    repository: toRegistryRepository(repositoryResponse.data),
  };
}

async function fetchRepositoryStatus(
  token: string,
  owner: string,
  repo: string,
): Promise<RegistryRepositoryStatus> {
  const repositoryData = await fetchRepositoryData(token, owner, repo);
  const octokit = getOctokit(token);

  let hasSkillsDirectory = true;

  try {
    await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: 'skills',
    });
  } catch (error) {
    const requestError = toGitHubRequestError(error);

    if (requestError?.status === 404) {
      hasSkillsDirectory = false;
    } else {
      throw error;
    }
  }

  return {
    hasSkillsDirectory,
    isPrivate: repositoryData.private,
    repository: repositoryData.repository,
  };
}

function toGitHubRequestError(error: unknown): GitHubRequestError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  return error as GitHubRequestError;
}

function isRateLimited(error: GitHubRequestError): boolean {
  return error.status === 403 && error.response?.headers['x-ratelimit-remaining'] === '0';
}

function formatGitHubError(error: unknown): string {
  if (error instanceof InvalidGitHubRepositoryUrlError) {
    return error.message;
  }

  if (error instanceof InsufficientGitHubScopeError) {
    return error.message;
  }

  const requestError = toGitHubRequestError(error);

  if (requestError !== null) {
    if (requestError.status === 401) {
      return 'GitHub rejected that token. Create a Personal Access Token with the "repo" scope and try again.';
    }

    if (requestError.status === 404) {
      return 'GitHub could not access that repository. Check the URL and make sure the token can read it.';
    }

    if (isRateLimited(requestError)) {
      return 'GitHub API rate limit reached. Try again after the rate limit resets.';
    }

    return `GitHub request failed (${requestError.status ?? 'unknown'}): ${requestError.message}`;
  }

  return String(error);
}

export const githubService: GitHubService = {
  async validateToken(token: string): Promise<ValidatedGitHubToken> {
    try {
      const octokit = getOctokit(token);
      const response = await octokit.request('GET /user');
      const scopes = normalizeScopes(response.headers['x-oauth-scopes']);

      if (!scopes.includes(REQUIRED_SCOPE)) {
        throw new InsufficientGitHubScopeError(
          'That token is missing the "repo" scope. Create a new token with the "repo" scope and try again.',
        );
      }

      return {
        githubToken: token,
        githubUsername: response.data.login,
        scopes,
      };
    } catch (error) {
      throw new Error(formatGitHubError(error));
    }
  },

  async createSkillsRepository(token: string): Promise<RegistryRepository> {
    try {
      const octokit = getOctokit(token);
      const response = await octokit.request('POST /user/repos', {
        name: 'skills',
        description: 'Personal agent skills registry managed by skill-forge',
        private: false,
        auto_init: true,
      });

      return toRegistryRepository(response.data);
    } catch (error) {
      const requestError = toGitHubRequestError(error);

      if (requestError !== null && requestError.status === 422) {
        throw new Error(
          'A repository named "skills" already exists on your account. Choose the manual option to point skill-forge at it instead.',
        );
      }

      throw new Error(formatGitHubError(error));
    }
  },

  async getRepository(token: string, repoUrl: string): Promise<RegistryRepository> {
    try {
      const { owner, repo } = parseGitHubRepoUrl(repoUrl);
      const repositoryData = await fetchRepositoryData(token, owner, repo);

      return repositoryData.repository;
    } catch (error) {
      throw new Error(formatGitHubError(error));
    }
  },

  async getRepositoryStatus(
    token: string,
    owner: string,
    repo: string,
  ): Promise<RegistryRepositoryStatus> {
    try {
      return await fetchRepositoryStatus(token, owner, repo);
    } catch (error) {
      throw new Error(formatGitHubError(error));
    }
  },

  async listRemoteSkills(token: string, owner: string, repo: string): Promise<string[]> {
    try {
      const octokit = getOctokit(token);
      const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path: 'skills',
      });

      if (!Array.isArray(response.data)) {
        return [];
      }

      return response.data
        .filter(
          (entry: { type: string; name: string }) =>
            entry.type === 'dir' && !entry.name.startsWith('.'),
        )
        .map((entry: { name: string }) => entry.name)
        .sort();
    } catch (error) {
      const requestError = toGitHubRequestError(error);

      if (requestError?.status === 404) {
        return [];
      }

      throw new Error(formatGitHubError(error));
    }
  },
};
