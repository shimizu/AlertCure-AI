import type { Octokit } from "@octokit/rest";
import type { AlertState, DependabotAlert, RepoSummary } from "../types.js";
import { listDependabotAlerts } from "./alerts.js";
import { createOctokit } from "./client.js";
import { fetchRepoSummaries } from "./repos.js";

export interface GitHubService {
  listRepos(): Promise<RepoSummary[]>;
  listAlerts(owner: string, repo: string, state?: AlertState): Promise<DependabotAlert[]>;
}

export function createGitHubService(getOctokit: () => Promise<Octokit> = memoizedOctokit()): GitHubService {
  return {
    listRepos: async () => fetchRepoSummaries(await getOctokit()),
    listAlerts: async (owner, repo, state) => listDependabotAlerts(await getOctokit(), owner, repo, state),
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
