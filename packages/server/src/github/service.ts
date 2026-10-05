import type { Octokit } from "@octokit/rest";
import type { AlertState, DependabotAlert, RepoSummary } from "../types.js";
import { createPullRequest, dismissDependabotAlert, listDependabotAlerts, type DismissReason } from "./alerts.js";
import { createOctokit } from "./client.js";
import { fetchRepoSummaries, type RepoFetchProgress } from "./repos.js";

export interface GitHubService {
  listRepos(onProgress?: (progress: RepoFetchProgress) => void): Promise<RepoSummary[]>;
  listAlerts(owner: string, repo: string, state?: AlertState): Promise<DependabotAlert[]>;
  getDefaultBranch(owner: string, repo: string): Promise<string>;
  dismissAlert(params: {
    owner: string;
    repo: string;
    alertNumber: number;
    reason: DismissReason;
    comment?: string;
  }): Promise<DependabotAlert>;
  createPullRequest(params: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string }>;
}

export function createGitHubService(getOctokit: () => Promise<Octokit> = memoizedOctokit()): GitHubService {
  return {
    listRepos: async (onProgress) => fetchRepoSummaries(await getOctokit(), { onProgress }),
    listAlerts: async (owner, repo, state) => listDependabotAlerts(await getOctokit(), owner, repo, state),
    getDefaultBranch: async (owner, repo) => {
      const { data } = await (await getOctokit()).rest.repos.get({ owner, repo });
      return data.default_branch;
    },
    dismissAlert: async (params) => dismissDependabotAlert(await getOctokit(), params),
    createPullRequest: async (params) => createPullRequest(await getOctokit(), params),
  };
}

/** Octokit は一度作ったら使い回す（トークン取得に失敗した場合は次回やり直す） */
function memoizedOctokit(): () => Promise<Octokit> {
  let pending: Promise<Octokit> | undefined;
  return () => {
    pending ??= createOctokit().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
