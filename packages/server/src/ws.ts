import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage } from "./agent/events.js";
import type { SessionManager } from "./agent/session.js";

const SESSION_PATH = /^\/ws\/sessions\/([0-9a-f-]+)$/;

/** 他のサイトのページから接続されないよう、ローカルのオリジンだけを受け付ける */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // ブラウザ以外（CLI など）からの接続
  try {
    const { hostname } = new URL(origin);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

function parseClientMessage(data: string): ClientMessage | null {
  try {
    const message = JSON.parse(data) as Partial<ClientMessage>;
    if (message.type === "user_message" && typeof message.text === "string" && message.text.trim()) {
      return { type: "user_message", text: message.text };
    }
    if (message.type === "interrupt") return { type: "interrupt" };
  } catch {
    // 下で null を返す
  }
  return null;
}

/** `WS /ws/sessions/:id` を HTTP サーバーに追加する */
export function attachSessionSocket(server: Server, sessions: SessionManager): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const match = SESSION_PATH.exec(new URL(req.url ?? "", "http://localhost").pathname);
    const session = match?.[1] ? sessions.get(match[1]) : undefined;
    if (!session || !isAllowedOrigin(req.headers.origin)) {
      socket.end(`HTTP/1.1 ${session ? "403 Forbidden" : "404 Not Found"}\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const unsubscribe = session.subscribe((event) => ws.send(JSON.stringify(event)));
      ws.on("message", (data) => {
        const message = parseClientMessage(data.toString());
        if (message?.type === "user_message") session.send(message.text);
        else if (message?.type === "interrupt") void session.interrupt();
      });
      ws.on("close", unsubscribe);
    });
  });
}
