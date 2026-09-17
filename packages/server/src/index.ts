import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const HOST = "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp().fetch, hostname: HOST, port }, (info) => {
  console.log(`AlertCure server listening on http://${HOST}:${info.port}`);
});
