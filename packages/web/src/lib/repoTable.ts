import type { RepoSummary, Severity } from "./types";

export interface RepoFilters {
  query: string;
  onlyWithAlerts: boolean;
  includeArchived: boolean;
  includeForks: boolean;
  visibility: "all" | "public" | "private";
}

export const DEFAULT_REPO_FILTERS: RepoFilters = {
  query: "",
  onlyWithAlerts: true,
  includeArchived: false,
  includeForks: true,
  visibility: "all",
};

export type RepoSortKey = "name" | "total" | Severity | "pushedAt";
export interface RepoSort {
  key: RepoSortKey;
  desc: boolean;
}

export function filterRepos(repos: RepoSummary[], filters: RepoFilters): RepoSummary[] {
  const query = filters.query.trim().toLowerCase();
  return repos.filter((repo) => {
    if (query && !repo.fullName.toLowerCase().includes(query)) return false;
    if (filters.onlyWithAlerts && repo.openAlerts.total === 0) return false;
    if (!filters.includeArchived && repo.isArchived) return false;
    if (!filters.includeForks && repo.isFork) return false;
    if (filters.visibility === "public" && repo.isPrivate) return false;
    if (filters.visibility === "private" && !repo.isPrivate) return false;
    return true;
  });
}

function sortValue(repo: RepoSummary, key: RepoSortKey): string | number {
  switch (key) {
    case "name":
      return repo.fullName.toLowerCase();
    case "pushedAt":
      return repo.pushedAt ?? "";
    default:
      return repo.openAlerts[key];
  }
}

/**
 * 件数で並べるときは、同数なら重大度の高い順（critical → high → …）で並べる。
 * 名前順は常に最後の比較に使う。
 */
export function sortRepos(repos: RepoSummary[], sort: RepoSort): RepoSummary[] {
  const dir = sort.desc ? -1 : 1;
  const tieBreakers: RepoSortKey[] = ["critical", "high", "medium", "low"];
  return [...repos].sort((a, b) => {
    for (const key of [sort.key, ...tieBreakers]) {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av !== bv) return (av < bv ? -1 : 1) * (key === sort.key ? dir : -1);
    }
    return a.fullName.localeCompare(b.fullName);
  });
}

export function sumAlerts(repos: RepoSummary[]) {
  const totals = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
  for (const repo of repos) {
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      totals[key] += repo.openAlerts[key];
    }
  }
  return totals;
}
