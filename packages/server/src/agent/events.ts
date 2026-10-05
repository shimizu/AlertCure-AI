/** WebSocket でやり取りするメッセージの型（web からも型だけ参照する） */

export type SessionStatus = "preparing" | "running" | "idle" | "error" | "closed";

export type ServerEvent =
  | { type: "status"; status: SessionStatus; detail?: string }
  | { type: "user_message"; text: string }
  /** アシスタントの文章の断片。連続する断片をつなげると 1 つの発言になる */
  | { type: "assistant_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; isError: boolean; content: string }
  | { type: "result"; isError: boolean; costUsd: number; durationMs: number; numTurns: number }
  | { type: "error"; message: string };

export type ClientMessage = { type: "user_message"; text: string } | { type: "interrupt" };

export interface SessionInfo {
  id: string;
  owner: string;
  repo: string;
  alertNumbers: number[];
  status: SessionStatus;
  /** 作業ディレクトリ（準備が終わるまでは null） */
  workspace: string | null;
  createdAt: string;
}
