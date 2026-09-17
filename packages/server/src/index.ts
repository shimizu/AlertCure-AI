import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Cache } from "./db/cache.js";
import { createGitHubService } from "./github/service.js";

const HOST = "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);

const app = createApp({ github: createGitHubService(), cache: new Cache() });

serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  console.log(`AlertCure server listening on http://${HOST}:${info.port}`);
});
