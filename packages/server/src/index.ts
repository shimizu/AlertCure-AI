import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { SessionManager } from "./agent/session.js";
import { createApp } from "./app.js";
import { Cache } from "./db/cache.js";
import { createGitHubService } from "./github/service.js";
import { WorkspaceManager } from "./workspace/manager.js";
import { attachSessionSocket } from "./ws.js";

const HOST = "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);

const github = createGitHubService();
const sessions = new SessionManager({ github, workspaces: new WorkspaceManager() });
const app = createApp({ github, cache: new Cache(), sessions });

const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  console.log(`AlertCure server listening on http://${HOST}:${info.port}`);
});
attachSessionSocket(server as Server, sessions);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    sessions.closeAll();
    process.exit(0);
  });
}
