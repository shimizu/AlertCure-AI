/** WebSocket でやり取りするメッセージの型（web からも型だけ参照する） */

/** suspended: サーバーの再起動で止まっていて、次のメッセージで再開する */
export type SessionStatus = "preparing" | "running" | "idle" | "suspended" | "error" | "closed";

export type ServerEvent =
  | { type: "status"; status: SessionStatus; detail?: string }
  | { type: "user_message"; text: string }
  /** アシスタントの文章の断片。連続する断片をつなげると 1 つの発言になる */
  | { type: "assistant_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; isError: boolean; content: string }
  /** ユーザーの承認待ち。approval_resolved が来るまで有効 */
  | { type: "approval_request"; id: string; toolName: string; title: string; reason: string; input: unknown; preview: string | null }
  | { type: "approval_resolved"; id: string; approved: boolean }
  | { type: "result"; isError: boolean; costUsd: number; durationMs: number; numTurns: number }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "user_message"; text: string }
  | { type: "interrupt" }
  | { type: "approval_response"; id: string; approved: boolean; message?: string };

export interface SessionInfo {
  id: string;
  owner: string;
  repo: string;
  alertNumbers: number[];
  status: SessionStatus;
  /** 作業ディレクトリ（準備が終わるまでは null） */
  workspace: string | null;
  /** 作業ブランチ（alertcure/fix-<番号>） */
  branch: string;
  createdAt: string;
}
