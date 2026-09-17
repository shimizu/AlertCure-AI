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

  it("GET /api/repos starts a background refresh when nothing is cached", async () => {
    const first = await app.request("/api/repos");
    const body = await first.json();
    expect(body.repos).toBeNull();
    expect(body.refresh.running).toBe(true);

    await vi.waitFor(() => expect(cache.get("repos")).toBeDefined());
    const second = await (await app.request("/api/repos")).json();
    expect(second.repos).toEqual([repo]);
    expect(second.refresh.running).toBe(false);
    expect(github.listRepos).toHaveBeenCalledTimes(1);
  });

  it("POST /api/repos/refresh refetches and ignores duplicate requests", async () => {
    cache.set("repos", []);
    await app.request("/api/repos/refresh", { method: "POST" });
    const res = await app.request("/api/repos/refresh", { method: "POST" });
    expect(res.status).toBe(202);
    await vi.waitFor(async () => expect((await (await app.request("/api/repos")).json()).repos).toEqual([repo]));
    expect(github.listRepos).toHaveBeenCalledTimes(1);
  });

  it("reports refresh failures and does not retry automatically", async () => {
    github.listRepos.mockRejectedValueOnce(new GitHubAuthError("no token"));
    await app.request("/api/repos");
    await vi.waitFor(async () =>
      expect((await (await app.request("/api/repos")).json()).refresh.error).toBe("no token"),
    );
    expect(github.listRepos).toHaveBeenCalledTimes(1);
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
    github.listAlerts.mockRejectedValueOnce(new GitHubAuthError("no token"));
    const res = await app.request("/api/repos/octo/app/alerts");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("github_auth");
  });
});
