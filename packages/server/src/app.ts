import { Hono } from "hono";
import { cached, type Cache } from "./db/cache.js";
import { AlertsDisabledError } from "./github/alerts.js";
import { GitHubAuthError } from "./github/client.js";
import type { GitHubService } from "./github/service.js";
import type { AlertState, DependabotAlert, RepoSummary } from "./types.js";

export interface AppDeps {
  github: GitHubService;
  cache: Cache;
}

const ALERT_STATES: AlertState[] = ["open", "dismissed", "fixed", "auto_dismissed"];

export function createApp({ github, cache }: AppDeps) {
  const app = new Hono().basePath("/api");

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/repos", async (c) => {
    const refresh = c.req.query("refresh") === "1";
    const entry = await cached<RepoSummary[]>(cache, "repos", refresh, () => github.listRepos());
    return c.json({ repos: entry.value, fetchedAt: entry.fetchedAt });
  });

  app.get("/repos/:owner/:repo/alerts", async (c) => {
    const { owner, repo } = c.req.param();
    const state = c.req.query("state") ?? "open";
    if (!ALERT_STATES.includes(state as AlertState)) {
      return c.json({ error: `state は ${ALERT_STATES.join(", ")} のいずれかを指定してください。` }, 400);
    }
    const refresh = c.req.query("refresh") === "1";
    const entry = await cached<DependabotAlert[]>(cache, `alerts:${owner}/${repo}:${state}`, refresh, () =>
      github.listAlerts(owner, repo, state as AlertState),
    );
    return c.json({ alerts: entry.value, fetchedAt: entry.fetchedAt });
  });

  app.onError((error, c) => {
    if (error instanceof GitHubAuthError) {
      return c.json({ error: error.message, code: "github_auth" }, 401);
    }
    if (error instanceof AlertsDisabledError) {
      return c.json({ error: error.message, code: "alerts_disabled" }, 409);
    }
    console.error(error);
    return c.json({ error: "サーバーでエラーが発生しました。", detail: error.message }, 500);
  });

  return app;
}
