import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ServerEvent, SessionStatus } from "../agent/events.js";
import type { PreparedWorkspace } from "../workspace/manager.js";
import { DEFAULT_DB_PATH } from "./cache.js";

/** サーバーを再起動しても会話を再開できるよう保存する、セッションの情報 */
export interface StoredSession {
  id: string;
  owner: string;
  repo: string;
  alertNumbers: number[];
  branch: string;
  status: SessionStatus;
  createdAt: string;
  /** SDK のセッション ID（resume に使う） */
  sdkSessionId: string | null;
  workspace: PreparedWorkspace | null;
  defaultBranch: string | null;
  history: ServerEvent[];
}

interface Row {
  id: string;
  owner: string;
  repo: string;
  alert_numbers: string;
  branch: string;
  status: string;
  created_at: string;
  sdk_session_id: string | null;
  workspace: string | null;
  default_branch: string | null;
  history: string;
}

function fromRow(row: Row): StoredSession {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    alertNumbers: JSON.parse(row.alert_numbers) as number[],
    branch: row.branch,
    status: row.status as SessionStatus,
    createdAt: row.created_at,
    sdkSessionId: row.sdk_session_id,
    workspace: row.workspace ? (JSON.parse(row.workspace) as PreparedWorkspace) : null,
    defaultBranch: row.default_branch,
    history: JSON.parse(row.history) as ServerEvent[],
  };
}

export class SessionStore {
  private readonly db: DatabaseSync;

  constructor(path: string = process.env.ALERTCURE_DB ?? DEFAULT_DB_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        alert_numbers TEXT NOT NULL,
        branch TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sdk_session_id TEXT,
        workspace TEXT,
        default_branch TEXT,
        history TEXT NOT NULL
      )
    `);
  }

  save(session: StoredSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, owner, repo, alert_numbers, branch, status, created_at, sdk_session_id, workspace, default_branch, history)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           sdk_session_id = excluded.sdk_session_id,
           workspace = excluded.workspace,
           default_branch = excluded.default_branch,
           history = excluded.history`,
      )
      .run(
        session.id,
        session.owner,
        session.repo,
        JSON.stringify(session.alertNumbers),
        session.branch,
        session.status,
        session.createdAt,
        session.sdkSessionId,
        session.workspace ? JSON.stringify(session.workspace) : null,
        session.defaultBranch,
        JSON.stringify(session.history),
      );
  }

  list(): StoredSession[] {
    return (this.db.prepare("SELECT * FROM sessions ORDER BY created_at").all() as unknown as Row[]).map(fromRow);
  }

  close(): void {
    this.db.close();
  }
}
