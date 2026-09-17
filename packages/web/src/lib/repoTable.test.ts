import { describe, expect, it } from "vitest";
import { DEFAULT_REPO_FILTERS, filterRepos, sortRepos, sumAlerts } from "./repoTable";
import type { RepoSummary } from "./types";

function repo(name: string, counts: Partial<RepoSummary["openAlerts"]>, extra: Partial<RepoSummary> = {}) {
  const openAlerts = { critical: 0, high: 0, medium: 0, low: 0, ...counts, total: 0 };
  openAlerts.total = openAlerts.critical + openAlerts.high + openAlerts.medium + openAlerts.low;
  return {
    owner: "octo",
    name,
    fullName: `octo/${name}`,
    url: "",
    isPrivate: false,
    isArchived: false,
    isFork: false,
    pushedAt: null,
    defaultBranch: "main",
    language: null,
    alertsEnabled: true,
    openAlerts,
    ...extra,
  } satisfies RepoSummary;
}

const repos = [
  repo("clean", {}),
  repo("archived", { high: 3 }, { isArchived: true }),
  repo("secret", { low: 5 }, { isPrivate: true }),
  repo("fork", { critical: 1 }, { isFork: true }),
  repo("app", { critical: 1, high: 1 }),
];

describe("filterRepos", () => {
  it("hides repos without alerts and archived repos by default", () => {
    expect(filterRepos(repos, DEFAULT_REPO_FILTERS).map((r) => r.name)).toEqual(["secret", "fork", "app"]);
  });

  it("applies query, fork and visibility filters", () => {
    const names = (f: Partial<typeof DEFAULT_REPO_FILTERS>) =>
      filterRepos(repos, { ...DEFAULT_REPO_FILTERS, ...f }).map((r) => r.name);
    expect(names({ query: "SEC" })).toEqual(["secret"]);
    expect(names({ includeForks: false })).toEqual(["secret", "app"]);
    expect(names({ visibility: "private" })).toEqual(["secret"]);
    expect(names({ onlyWithAlerts: false, includeArchived: true })).toHaveLength(5);
  });
});

describe("sortRepos", () => {
  it("sorts by total and breaks ties by severity", () => {
    const sorted = sortRepos(repos, { key: "total", desc: true }).map((r) => r.name);
    expect(sorted).toEqual(["secret", "archived", "app", "fork", "clean"]);
  });

  it("sorts by name ascending", () => {
    expect(sortRepos(repos, { key: "name", desc: false }).map((r) => r.name)).toEqual([
      "app",
      "archived",
      "clean",
      "fork",
      "secret",
    ]);
  });
});

describe("sumAlerts", () => {
  it("adds up every severity", () => {
    expect(sumAlerts(repos)).toEqual({ total: 11, critical: 2, high: 4, medium: 0, low: 5 });
  });
});
