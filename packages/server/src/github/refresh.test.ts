import { describe, expect, it } from "vitest";
import { Cache } from "../db/cache.js";
import { RepoRefresher } from "./refresh.js";
import type { GitHubService } from "./service.js";

describe("RepoRefresher", () => {
  it("exposes progress while running and stores the result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const github: GitHubService = {
      listRepos: async (onProgress) => {
        onProgress?.({ repos: 5, reposTotal: 10, followUpsTotal: 2, followUpsDone: 1 });
        await gate;
        return [];
      },
      listAlerts: async () => [],
    };
    const cache = new Cache(":memory:");
    const refresher = new RepoRefresher(github, cache);

    const done = refresher.start();
    expect(refresher.start()).toBe(done);
    expect(refresher.getStatus()).toMatchObject({
      running: true,
      progress: { repos: 5, reposTotal: 10, followUpsTotal: 2, followUpsDone: 1 },
    });

    release();
    await done;
    expect(refresher.getStatus()).toMatchObject({ running: false, error: null });
    expect(cache.get("repos")?.value).toEqual([]);
    cache.close();
  });
});
