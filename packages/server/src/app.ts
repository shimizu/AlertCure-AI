import { Hono } from "hono";
import { SessionConflictError, type SessionManager } from "./agent/session.js";
import { cached, type Cache } from "./db/cache.js";
import { AlertsDisabledError } from "./github/alerts.js";
import { GitHubAuthError } from "./github/client.js";
import { REPOS_CACHE_KEY, RepoRefresher } from "./github/refresh.js";
import type { GitHubService } from "./github/service.js";
import type { AlertState, DependabotAlert, RepoSummary } from "./types.js";

export interface AppDeps {
  github: GitHubService;
  cache: Cache;
  sessions: SessionManager;
}

const ALERT_STATES: AlertState[] = ["open", "dismissed", "fixed", "auto_dismissed"];

export function createApp({ github, cache, sessions }: AppDeps) {
  const app = new Hono().basePath("/api");
  const refresher = new RepoRefresher(github, cache);

  app.get("/health", (c) => c.json({ status: "ok" }));

  // キャッシュ済みの一覧と取得状況を返す。
  // キャッシュがなければ取得を開始する（失敗後は POST /repos/refresh で再試行する）
  app.get("/repos", (c) => {
    const entry = cache.get<RepoSummary[]>(REPOS_CACHE_KEY);
    if (!entry && !refresher.getStatus().error) void refresher.start();
    return c.json({
      repos: entry?.value ?? null,
      fetchedAt: entry?.fetchedAt ?? null,
      refresh: refresher.getStatus(),
    });
  });

  app.post("/repos/refresh", (c) => {
    void refresher.start();
    return c.json({ refresh: refresher.getStatus() }, 202);
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

  app.post("/sessions", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      owner?: unknown;
      repo?: unknown;
      alertNumbers?: unknown;
    } | null;
    const { owner, repo, alertNumbers } = body ?? {};
    if (
      typeof owner !== "string" ||
      typeof repo !== "string" ||
      !Array.isArray(alertNumbers) ||
      alertNumbers.length === 0 ||
      !alertNumbers.every((n) => Number.isInteger(n) && n > 0)
    ) {
      return c.json({ error: "owner, repo, alertNumbers（1件以上の Alert 番号）を指定してください。" }, 400);
    }
    const session = sessions.create(owner, repo, alertNumbers as number[]);
    return c.json(session.info(), 201);
  });

  app.get("/repos/:owner/:repo/sessions", (c) => {
    const { owner, repo } = c.req.param();
    return c.json({ sessions: sessions.list(owner, repo).map((s) => s.info()) });
  });

  app.get("/sessions/:id", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "セッションが見つかりません。サーバーを再起動した場合は、もう一度開始してください。" }, 404);
    return c.json(session.info());
  });

  app.delete("/sessions/:id", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "セッションが見つかりません。" }, 404);
    session.close();
    return c.json(session.info());
  });

  app.onError((error, c) => {
    if (error instanceof SessionConflictError) {
      return c.json({ error: error.message, code: "session_conflict", sessionId: error.sessionId }, 409);
    }
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
