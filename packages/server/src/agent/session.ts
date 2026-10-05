import { randomUUID } from "node:crypto";
import {
  query,
  type HookCallback,
  type Options,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { GitHubService } from "../github/service.js";
import type { PreparedWorkspace, WorkspaceManager } from "../workspace/manager.js";
import type { ServerEvent, SessionInfo, SessionStatus } from "./events.js";
import { decideToolUse } from "./permissions.js";
import { buildInitialPrompt, buildSystemPromptAppend } from "./prompt.js";
import { createAlertTools } from "./tools.js";

export const DEFAULT_MODEL = "claude-opus-5-5";
const TOOL_RESULT_LIMIT = 4000;

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage> & {
  interrupt(): Promise<unknown>;
};

export interface AgentSessionDeps {
  github: GitHubService;
  workspaces: Pick<WorkspaceManager, "prepare" | "run" | "push">;
  runQuery?: QueryFn;
  model?: string;
  /** Alert を dismiss したあとに呼ぶ（キャッシュの破棄など） */
  onAlertsChanged?: (owner: string, repo: string) => void;
}

export function branchName(alertNumbers: number[]): string {
  return `alertcure/fix-${[...alertNumbers].sort((a, b) => a - b).join("-")}`;
}

/** 承認ダイアログの見出し */
export function approvalTitle(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return `コマンドを実行: ${String(input.command ?? "")}`;
    case "mcp__alertcure__create_pull_request":
      return `Pull Request を作成: ${String(input.title ?? "")}`;
    case "mcp__alertcure__dismiss_alert":
      return `Alert #${String(input.number ?? "?")} を dismiss（理由: ${String(input.reason ?? "")}）`;
    default:
      return toolName;
  }
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
  readonly branch: string;
  /** SDK のセッション ID（ステップ6で resume に使う） */
  sdkSessionId: string | null = null;
  workspace: PreparedWorkspace | null = null;

  private currentStatus: SessionStatus = "preparing";
  private readonly history: ServerEvent[] = [];
  private readonly listeners = new Set<(event: ServerEvent) => void>();
  private readonly input = new InputQueue();
  private readonly abort = new AbortController();
  private readonly approvals = new Map<string, (answer: { approved: boolean; message?: string }) => void>();
  private running: ReturnType<QueryFn> | null = null;

  constructor(
    readonly owner: string,
    readonly repo: string,
    readonly alertNumbers: number[],
    private readonly deps: AgentSessionDeps,
  ) {
    this.branch = branchName(alertNumbers);
  }

  get status(): SessionStatus {
    return this.currentStatus;
  }

  get active(): boolean {
    return this.status !== "closed" && this.status !== "error";
  }

  info(): SessionInfo {
    const { id, owner, repo, alertNumbers, status, branch, createdAt } = this;
    return { id, owner, repo, alertNumbers, status, workspace: this.workspace?.dir ?? null, branch, createdAt };
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
      const [workspace, defaultBranch, openAlerts] = await Promise.all([
        workspaces.prepare(this.owner, this.repo, this.branch),
        github.getDefaultBranch(this.owner, this.repo),
        github.listAlerts(this.owner, this.repo, "open"),
      ]);
      const alerts = openAlerts.filter((a) => this.alertNumbers.includes(a.number));
      if (alerts.length === 0) throw new Error("選択された Alert が見つかりません（すでに対応済みの可能性があります）。");
      if (this.abort.signal.aborted) return;
      this.workspace = workspace;
      const cwd = workspace.dir;

      // 自動で許可されるツールも含め、すべての呼び出しを同じ規則で判定する。
      // 承認が必要なもの（ask）は SDK が canUseTool を呼ぶので、そこでユーザーに確認する
      const preToolUse: HookCallback = async (hookInput) => {
        if (hookInput.hook_event_name !== "PreToolUse") return {};
        const decision = decideToolUse(cwd, hookInput.tool_name, (hookInput.tool_input ?? {}) as Record<string, unknown>);
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: decision.behavior,
            permissionDecisionReason:
              decision.behavior === "deny" ? decision.message : decision.behavior === "ask" ? decision.reason : undefined,
          },
        };
      };

      const runQuery = this.deps.runQuery ?? (query as QueryFn);
      this.running = runQuery({
        prompt: this.input,
        options: {
          cwd,
          model: this.deps.model ?? process.env.ALERTCURE_MODEL ?? DEFAULT_MODEL,
          effort: "high",
          systemPrompt: { type: "preset", preset: "claude_code", append: buildSystemPromptAppend(this.branch, defaultBranch) },
          tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
          mcpServers: {
            alertcure: createAlertTools({
              github,
              workspaces,
              owner: this.owner,
              repo: this.repo,
              alertNumbers: this.alertNumbers,
              workspace,
              defaultBranch,
              onAlertsChanged: () => this.deps.onAlertsChanged?.(this.owner, this.repo),
            }),
          },
          // ユーザーの ~/.claude などの設定は読み込まない
          settingSources: [],
          includePartialMessages: true,
          abortController: this.abort,
          hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
          canUseTool: async (toolName, toolInput, { signal }) => {
            const decision = decideToolUse(cwd, toolName, toolInput);
            if (decision.behavior === "ask") return this.requestApproval(toolName, toolInput, decision.reason, signal);
            return decision;
          },
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
    if (!this.active) return;
    this.emit({ type: "user_message", text });
    this.input.push(text);
    this.setStatus("running");
  }

  async interrupt(): Promise<void> {
    if (this.status === "running") await this.running?.interrupt();
  }

  /** 承認ダイアログへの回答を受け取る */
  respondApproval(id: string, approved: boolean, message?: string): void {
    this.approvals.get(id)?.({ approved, message });
  }

  close(): void {
    for (const resolve of this.approvals.values()) resolve({ approved: false, message: "セッションが終了しました。" });
    this.input.close();
    this.abort.abort();
    this.setStatus("closed");
  }

  private async requestApproval(
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const id = randomUUID();
    const preview = await this.approvalPreview(toolName).catch(() => null);
    const answer = await new Promise<{ approved: boolean; message?: string }>((resolve) => {
      this.approvals.set(id, resolve);
      signal.addEventListener("abort", () => resolve({ approved: false, message: "中断されました。" }), { once: true });
      this.emit({ type: "approval_request", id, toolName, title: approvalTitle(toolName, input), reason, input, preview });
    });
    // 中断と回答が重なっても、解決の通知は一度だけ送る
    if (!this.approvals.delete(id)) return { behavior: "deny", message: "中断されました。" };
    this.emit({ type: "approval_resolved", id, approved: answer.approved });
    if (answer.approved) return { behavior: "allow", updatedInput: input };
    const message = answer.message?.trim();
    return { behavior: "deny", message: message ? `ユーザーが拒否しました。理由: ${message}` : "ユーザーが拒否しました。" };
  }

  /** PR の作成前に、コミットと変更の概要を見せる */
  private async approvalPreview(toolName: string): Promise<string | null> {
    if (toolName !== "mcp__alertcure__create_pull_request" || !this.workspace) return null;
    const { dir, baseSha } = this.workspace;
    const run = (args: string[]) => this.deps.workspaces.run(dir, args);
    const [log, stat, status] = await Promise.all([
      run(["log", "--oneline", `${baseSha}..HEAD`]),
      run(["diff", "--stat", baseSha, "HEAD"]),
      run(["status", "--short"]),
    ]);
    return [
      `ブランチ: ${this.branch}`,
      `コミット:\n${log.trim() || "（なし）"}`,
      `変更されたファイル:\n${stat.trim() || "（なし）"}`,
      status.trim() ? `コミットされていない変更:\n${status.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
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

/** 同じリポジトリで進行中のセッションがあるときのエラー（作業ディレクトリを共有するため） */
export class SessionConflictError extends Error {
  constructor(readonly sessionId: string) {
    super("このリポジトリでは別のセッションが進行中です。終了してから新しく始めてください。");
    this.name = "SessionConflictError";
  }
}

/** 実行中のセッションをメモリ上で管理する */
export class SessionManager {
  private readonly sessions = new Map<string, AgentSession>();

  constructor(private readonly deps: AgentSessionDeps) {}

  create(owner: string, repo: string, alertNumbers: number[]): AgentSession {
    const existing = [...this.sessions.values()].find((s) => s.active && s.owner === owner && s.repo === repo);
    if (existing) throw new SessionConflictError(existing.id);
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
