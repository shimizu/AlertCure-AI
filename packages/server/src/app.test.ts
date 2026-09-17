import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { Cache } from "./db/cache.js";
import { AlertsDisabledError } from "./github/alerts.js";
import { GitHubAuthError } from "./github/client.js";
import type { GitHubService } from "./github/service.js";
import { emptySeverityCounts, type RepoSummary } from "./types.js";

const repo: RepoSummary = {
  owner: "octo",
  name: "app",
  fullName: "octo/app",
  url: "https://github.com/octo/app",
  isPrivate: false,
  isArchived: false,
  isFork: false,
  pushedAt: null,
  defaultBranch: "main",
  language: "TypeScript",
  alertsEnabled: true,
  openAlerts: { ...emptySeverityCounts(), total: 1, high: 1 },
};

describe("API", () => {
  let cache: Cache;
  let github: { listRepos: ReturnType<typeof vi.fn>; listAlerts: ReturnType<typeof vi.fn> };
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    cache = new Cache(":memory:");
    github = { listRepos: vi.fn(async () => [repo]), listAlerts: vi.fn(async () => []) };
    app = createApp({ github: github as unknown as GitHubService, cache });
  });
  afterEach(() => cache.close());

  it("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/repos caches results until refresh=1", async () => {
    const first = await app.request("/api/repos");
    expect(first.status).toBe(200);
    expect((await first.json()).repos).toEqual([repo]);

    await app.request("/api/repos");
    expect(github.listRepos).toHaveBeenCalledTimes(1);

    await app.request("/api/repos?refresh=1");
    expect(github.listRepos).toHaveBeenCalledTimes(2);
  });

  it("GET /api/repos/:owner/:repo/alerts passes state and caches per state", async () => {
    await app.request("/api/repos/octo/app/alerts");
    await app.request("/api/repos/octo/app/alerts?state=fixed");
    await app.request("/api/repos/octo/app/alerts");
    expect(github.listAlerts.mock.calls).toEqual([
      ["octo", "app", "open"],
      ["octo", "app", "fixed"],
    ]);
  });

  it("rejects unknown alert state", async () => {
    const res = await app.request("/api/repos/octo/app/alerts?state=bogus");
    expect(res.status).toBe(400);
  });

  it("maps disabled alerts to 409", async () => {
    github.listAlerts.mockRejectedValueOnce(new AlertsDisabledError("octo/app"));
    const res = await app.request("/api/repos/octo/app/alerts");
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("alerts_disabled");
  });

  it("maps auth failures to 401", async () => {
    github.listRepos.mockRejectedValueOnce(new GitHubAuthError("no token"));
    const res = await app.request("/api/repos");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("github_auth");
  });
});
