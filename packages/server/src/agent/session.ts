import { randomUUID } from "node:crypto";
import { query, type Options, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { GitHubService } from "../github/service.js";
import type { ServerEvent, SessionInfo, SessionStatus } from "./events.js";
import { decideToolUse } from "./permissions.js";
import { buildInitialPrompt, SYSTEM_PROMPT_APPEND } from "./prompt.js";
import { createAlertTools } from "./tools.js";

export const DEFAULT_MODEL = "claude-opus-5-5";
const TOOL_RESULT_LIMIT = 4000;

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage> & {
  interrupt(): Promise<unknown>;
};

export interface AgentSessionDeps {
  github: GitHubService;
  workspaces: { prepare(owner: string, repo: string): Promise<string> };
  runQuery?: QueryFn;
  model?: string;
}

/** ユーザーの発言を SDK に渡すための非同期キュー（ストリーミング入力モード） */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(text: string): void {
    const item: SDKUserMessage = { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
    if (this.waiting) {
      this.waiting({ value: item, done: false });
      this.waiting = null;
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

function truncate(text: string): string {
  return text.length > TOOL_RESULT_LIMIT ? `${text.slice(0, TOOL_RESULT_LIMIT)}\n…（省略）` : text;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: { type?: string; text?: string }) => (block.type === "text" ? block.text : `[${block.type}]`))
      .join("\n");
  }
  return "";
}

/** SDK のメッセージを画面に送るイベントに変換する。サブエージェントの出力は扱わない */
export function translate(message: SDKMessage): ServerEvent[] {
  switch (message.type) {
    case "stream_event": {
      const { event } = message;
      if (message.parent_tool_use_id || event.type !== "content_block_delta" || event.delta.type !== "text_delta") return [];
      return [{ type: "assistant_delta", text: event.delta.text }];
    }
    case "assistant": {
      if (message.parent_tool_use_id) return [];
      return message.message.content.flatMap((block): ServerEvent[] =>
        block.type === "tool_use" ? [{ type: "tool_use", id: block.id, name: block.name, input: block.input }] : [],
      );
    }
    case "user": {
      const { content } = message.message;
      if (message.parent_tool_use_id || typeof content === "string") return [];
      return content.flatMap((block): ServerEvent[] =>
        block.type === "tool_result"
          ? [
              {
                type: "tool_result",
                toolUseId: block.tool_use_id,
                isError: block.is_error ?? false,
                content: truncate(toolResultText(block.content)),
              },
            ]
          : [],
      );
    }
    case "result": {
      const events: ServerEvent[] = [
        {
          type: "result",
          isError: message.is_error,
          costUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
          numTurns: message.num_turns,
        },
      ];
      if (message.subtype !== "success" && message.errors.length > 0) {
        events.push({ type: "error", message: message.errors.join("\n") });
      }
      return events;
    }
    default:
      return [];
  }
}

/** 1 件の Alert 対応セッション。SDK の query() をストリーミング入力モードで動かし、イベントを購読者に流す */
export class AgentSession {
  readonly id = randomUUID();
  readonly createdAt = new Date().toISOString();
  /** SDK のセッション ID（ステップ6で resume に使う） */
  sdkSessionId: string | null = null;
  workspace: string | null = null;

  private currentStatus: SessionStatus = "preparing";
  private readonly history: ServerEvent[] = [];
  private readonly listeners = new Set<(event: ServerEvent) => void>();
  private readonly input = new InputQueue();
  private readonly abort = new AbortController();
  private running: ReturnType<QueryFn> | null = null;

  constructor(
    readonly owner: string,
    readonly repo: string,
    readonly alertNumbers: number[],
    private readonly deps: AgentSessionDeps,
  ) {}

  get status(): SessionStatus {
    return this.currentStatus;
  }

  info(): SessionInfo {
    const { id, owner, repo, alertNumbers, status, workspace, createdAt } = this;
    return { id, owner, repo, alertNumbers, status, workspace, createdAt };
  }

  /** 履歴を流してから、以降のイベントを購読する */
  subscribe(listener: (event: ServerEvent) => void): () => void {
    for (const event of this.history) listener(event);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 作業ディレクトリを用意して最初の依頼を送る。完了（セッション終了）まで待つ Promise を返す */
  async start(): Promise<void> {
    try {
      this.emit({ type: "status", status: "preparing", detail: "リポジトリを準備しています" });
      const { github, workspaces } = this.deps;
      const [cwd, openAlerts] = await Promise.all([
        workspaces.prepare(this.owner, this.repo),
        github.listAlerts(this.owner, this.repo, "open"),
      ]);
      const alerts = openAlerts.filter((a) => this.alertNumbers.includes(a.number));
      if (alerts.length === 0) throw new Error("選択された Alert が見つかりません（すでに対応済みの可能性があります）。");
      if (this.abort.signal.aborted) return;
      this.workspace = cwd;

      const runQuery = this.deps.runQuery ?? (query as QueryFn);
      this.running = runQuery({
        prompt: this.input,
        options: {
          cwd,
          model: this.deps.model ?? process.env.ALERTCURE_MODEL ?? DEFAULT_MODEL,
          effort: "high",
          systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_PROMPT_APPEND },
          tools: ["Read", "Grep", "Glob"],
          mcpServers: { alertcure: createAlertTools(github, this.owner, this.repo) },
          // ユーザーの ~/.claude などの設定は読み込まない
          settingSources: [],
          includePartialMessages: true,
          abortController: this.abort,
          canUseTool: async (toolName, input) => decideToolUse(cwd, toolName, input),
        },
      });
      this.send(buildInitialPrompt(this.owner, this.repo, alerts));

      for await (const message of this.running) {
        if (message.type === "system" && message.subtype === "init") this.sdkSessionId = message.session_id;
        for (const event of translate(message)) this.emit(event);
        if (message.type === "result") this.setStatus("idle");
      }
      this.setStatus("closed");
    } catch (error) {
      if (this.abort.signal.aborted) {
        this.setStatus("closed");
        return;
      }
      this.emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
      this.setStatus("error");
    }
  }

  send(text: string): void {
    if (this.status === "closed" || this.status === "error") return;
    this.emit({ type: "user_message", text });
    this.input.push(text);
    this.setStatus("running");
  }

  async interrupt(): Promise<void> {
    if (this.status === "running") await this.running?.interrupt();
  }

  close(): void {
    this.input.close();
    this.abort.abort();
    this.setStatus("closed");
  }

  private setStatus(status: SessionStatus): void {
    if (this.status === status) return;
    this.emit({ type: "status", status });
  }

  private emit(event: ServerEvent): void {
    if (event.type === "status") this.currentStatus = event.status;
    // 文章の断片は履歴上ではつなげておき、再接続時に送る量を減らす
    const last = this.history.at(-1);
    if (event.type === "assistant_delta" && last?.type === "assistant_delta") {
      this.history[this.history.length - 1] = { type: "assistant_delta", text: last.text + event.text };
    } else {
      this.history.push(event);
    }
    for (const listener of this.listeners) listener(event);
  }
}

/** 実行中のセッションをメモリ上で管理する */
export class SessionManager {
  private readonly sessions = new Map<string, AgentSession>();

  constructor(private readonly deps: AgentSessionDeps) {}

  create(owner: string, repo: string, alertNumbers: number[]): AgentSession {
    const session = new AgentSession(owner, repo, alertNumbers, this.deps);
    this.sessions.set(session.id, session);
    void session.start();
    return session;
  }

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.close();
  }
}
