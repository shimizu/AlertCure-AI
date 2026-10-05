import type { ServerEvent, SessionStatus } from "./types";

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      result: { isError: boolean; content: string } | null;
    }
  | {
      kind: "approval";
      id: string;
      toolName: string;
      title: string;
      reason: string;
      input: unknown;
      preview: string | null;
      /** null のあいだは回答待ち */
      approved: boolean | null;
    }
  | { kind: "result"; isError: boolean; costUsd: number; durationMs: number; numTurns: number }
  | { kind: "error"; message: string };

export interface ChatState {
  items: ChatItem[];
  status: SessionStatus | null;
  statusDetail: string | null;
  /** セッション全体の累計コスト（SDK は累計値を返す） */
  costUsd: number;
}

export const initialChatState: ChatState = { items: [], status: null, statusDetail: null, costUsd: 0 };

/** 再接続時はサーバーが履歴を最初から送り直すため、いったん空に戻す */
export type ChatAction = ServerEvent | { type: "reset" };

/** 回答待ちの承認依頼（古い順） */
export function pendingApprovals(state: ChatState) {
  return state.items.filter((item): item is Extract<ChatItem, { kind: "approval" }> => item.kind === "approval" && item.approved === null);
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset":
      return initialChatState;
    case "status":
      return { ...state, status: action.status, statusDetail: action.detail ?? null };
    case "user_message":
      return { ...state, items: [...state.items, { kind: "user", text: action.text }] };
    case "assistant_delta": {
      const last = state.items.at(-1);
      if (last?.kind === "assistant") {
        return { ...state, items: [...state.items.slice(0, -1), { kind: "assistant", text: last.text + action.text }] };
      }
      return { ...state, items: [...state.items, { kind: "assistant", text: action.text }] };
    }
    case "tool_use":
      return {
        ...state,
        items: [...state.items, { kind: "tool", id: action.id, name: action.name, input: action.input, result: null }],
      };
    case "tool_result":
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "tool" && item.id === action.toolUseId
            ? { ...item, result: { isError: action.isError, content: action.content } }
            : item,
        ),
      };
    case "approval_request": {
      const { type: _, ...rest } = action;
      return { ...state, items: [...state.items, { kind: "approval", ...rest, approved: null }] };
    }
    case "approval_resolved":
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "approval" && item.id === action.id ? { ...item, approved: action.approved } : item,
        ),
      };
    case "result": {
      const { type: _, ...rest } = action;
      return { ...state, costUsd: action.costUsd, items: [...state.items, { kind: "result", ...rest }] };
    }
    case "error":
      return { ...state, items: [...state.items, { kind: "error", message: action.message }] };
  }
}

/** ツール呼び出しを 1 行で表す（例: `Read src/index.ts`） */
export function describeTool(name: string, input: unknown, workspace?: string): { label: string; detail: string } {
  const args = (input ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");
  const rel = (path: string) => (workspace && path.startsWith(`${workspace}/`) ? path.slice(workspace.length + 1) : path);
  switch (name) {
    case "Read":
      return { label: "ファイルを読む", detail: rel(str("file_path")) };
    case "Grep":
      return { label: "検索", detail: [str("pattern"), str("glob") || rel(str("path"))].filter(Boolean).join("  ") };
    case "Glob":
      return { label: "ファイルを探す", detail: str("pattern") };
    case "Edit":
      return { label: "ファイルを編集", detail: rel(str("file_path")) };
    case "Write":
      return { label: "ファイルを作成", detail: rel(str("file_path")) };
    case "Bash":
      return { label: "コマンドを実行", detail: str("command") };
    case "mcp__alertcure__create_pull_request":
      return { label: "Pull Request を作成", detail: str("title") };
    case "mcp__alertcure__dismiss_alert":
      return { label: "Alert を dismiss", detail: args.number ? `#${String(args.number)} ${str("reason")}` : "" };
    case "mcp__alertcure__get_alerts":
      return { label: "Alert の一覧を取得", detail: "" };
    case "mcp__alertcure__get_alert_detail":
      return { label: "Alert の詳細を取得", detail: args.number ? `#${String(args.number)}` : "" };
    default:
      return { label: name.replace(/^mcp__\w+?__/, ""), detail: JSON.stringify(input) };
  }
}
