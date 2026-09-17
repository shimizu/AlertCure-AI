import { Octokit } from "@octokit/rest";
import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchRepoSummaries } from "./repos.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const octokit = new Octokit({ auth: "test-token" });

function alerts(severities: string[], next: string | null) {
  return {
    pageInfo: { hasNextPage: next !== null, endCursor: next },
    nodes: severities.map((severity) => ({ securityVulnerability: { severity } })),
  };
}

function repoNode(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    owner: { login: "octo" },
    nameWithOwner: `octo/${name}`,
    url: `https://github.com/octo/${name}`,
    isPrivate: false,
    isArchived: false,
    isFork: false,
    pushedAt: "2026-09-01T00:00:00Z",
    defaultBranchRef: { name: "main" },
    primaryLanguage: null,
    hasVulnerabilityAlertsEnabled: true,
    vulnerabilityAlerts: alerts([], null),
    ...extra,
  };
}

describe("fetchRepoSummaries", () => {
  it("paginates repositories and aggregates severities, following alert pages", async () => {
    const repoCursors: (string | null)[] = [];
    const alertCursors: string[] = [];

    server.use(
      graphql.query("Repos", ({ variables }) => {
        repoCursors.push(variables.cursor ?? null);
        if (!variables.cursor) {
          return HttpResponse.json({
            data: {
              viewer: {
                repositories: {
                  pageInfo: { hasNextPage: true, endCursor: "R1" },
                  nodes: [
                    repoNode("big", {
                      vulnerabilityAlerts: alerts(["CRITICAL", "MODERATE"], "A1"),
                    }),
                    repoNode("off", { hasVulnerabilityAlertsEnabled: false }),
                  ],
                },
              },
            },
          });
        }
        return HttpResponse.json({
          data: {
            viewer: {
              repositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [repoNode("small", { vulnerabilityAlerts: alerts(["LOW", "HIGH"], null) })],
              },
            },
          },
        });
      }),
      graphql.query("RepoAlerts", ({ variables }) => {
        alertCursors.push(variables.cursor);
        expect(variables).toMatchObject({ owner: "octo", name: "big" });
        const page =
          variables.cursor === "A1" ? alerts(["HIGH", "HIGH"], "A2") : alerts(["MODERATE"], null);
        return HttpResponse.json({ data: { repository: { vulnerabilityAlerts: page } } });
      }),
    );

    const repos = await fetchRepoSummaries(octokit);

    expect(repoCursors).toEqual([null, "R1"]);
    expect(alertCursors).toEqual(["A1", "A2"]);
    expect(repos.map((r) => r.fullName)).toEqual(["octo/big", "octo/off", "octo/small"]);
    expect(repos[0]!.openAlerts).toEqual({ total: 5, critical: 1, high: 2, medium: 2, low: 0 });
    expect(repos[1]!.alertsEnabled).toBe(false);
    expect(repos[2]!.openAlerts).toEqual({ total: 2, critical: 0, high: 1, medium: 0, low: 1 });
  });

  it("halves the page size and retries the same cursor on 502", async () => {
    const calls: { cursor: string | null; pageSize: number }[] = [];
    server.use(
      graphql.query("Repos", ({ variables }) => {
        calls.push({ cursor: variables.cursor ?? null, pageSize: variables.pageSize });
        if (variables.pageSize > 5) return new HttpResponse("Bad Gateway", { status: 502 });
        return HttpResponse.json({
          data: {
            viewer: {
              repositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [repoNode("only")],
              },
            },
          },
        });
      }),
    );

    const repos = await fetchRepoSummaries(octokit, 20);

    expect(calls).toEqual([
      { cursor: null, pageSize: 20 },
      { cursor: null, pageSize: 10 },
      { cursor: null, pageSize: 5 },
    ]);
    expect(repos).toHaveLength(1);
  });

  it("gives up when the minimum page size still fails", async () => {
    server.use(graphql.query("Repos", () => new HttpResponse("Bad Gateway", { status: 502 })));
    await expect(fetchRepoSummaries(octokit, 4)).rejects.toMatchObject({ status: 502 });
  });
});
