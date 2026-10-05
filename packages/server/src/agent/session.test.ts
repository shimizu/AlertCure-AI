import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import type { GitHubService } from "../github/service.js";
import type { DependabotAlert } from "../types.js";
import type { ServerEvent } from "./events.js";
import { AgentSession, branchName, SessionConflictError, SessionManager, translate, type QueryFn } from "./session.js";

const alert: DependabotAlert = {
  number: 7,
  state: "open",
  url: "https://github.com/octo/app/security/dependabot/7",
  createdAt: "2026-01-01T00:00:00Z",
  severity: "high",
  package: { ecosystem: "npm", name: "lodash" },
  manifestPath: "package-lock.json",
  scope: "runtime",
  relationship: "transitive",
  ghsaId: "GHSA-xxxx",
  cveId: "CVE-2026-0001",
  summary: "Prototype pollution",
  vulnerableVersionRange: "< 4.17.21",
  firstPatchedVersion: "4.17.21",
  cvssScore: 7.5,
};

// テストでは SDK のメッセージの必要な項目だけを組み立てる
const msg = (value: object) => value as SDKMessage;
const delta = (text: string, parent: string | null = null) =>
  msg({ type: "stream_event", parent_tool_use_id: parent, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
const result = msg({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.12, duration_ms: 3000, num_turns: 2 });

describe("translate", () => {
  it("converts text deltas, tool calls, tool results and results", () => {
    expect(translate(delta("こん"))).toEqual([{ type: "assistant_delta", text: "こん" }]);
    expect(
      translate(msg({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "x" }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }] } })),
    ).toEqual([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]);
    expect(
      translate(msg({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "body" }] }] } })),
    ).toEqual([{ type: "tool_result", toolUseId: "t1", isError: false, content: "body" }]);
    expect(translate(result)).toEqual([{ type: "result", isError: false, costUsd: 0.12, durationMs: 3000, numTurns: 2 }]);
  });

  it("ignores subagent output and reports execution errors", () => {
    expect(translate(delta("x", "parent"))).toEqual([]);
    expect(
      translate(msg({ type: "result", subtype: "error_during_execution", is_error: true, total_cost_usd: 0, duration_ms: 1, num_turns: 0, errors: ["boom"] })),
    ).toContainEqual({ type: "error", message: "boom" });
  });
});

/** 受け取った依頼ごとに、決められた応答を返す偽の query() */
function fakeQuery(replies: SDKMessage[][]) {
  const prompts: string[] = [];
  let options: Parameters<QueryFn>[0]["options"] | undefined;
  const runQuery: QueryFn = ({ prompt, options: opts }) => {
    options = opts;
    async function* run() {
      yield msg({ type: "system", subtype: "init", session_id: "sdk-1" });
      let turn = 0;
      for await (const user of prompt as AsyncIterable<SDKUserMessage>) {
        prompts.push(user.message.content as string);
        yield* replies[turn++] ?? [];
      }
    }
    return Object.assign(run(), { interrupt: vi.fn(async () => undefined) });
  };
  return { runQuery, prompts, getOptions: () => options };
}

function setup(replies: SDKMessage[][], alerts: DependabotAlert[] = [alert]) {
  const fake = fakeQuery(replies);
  const github = {
    listRepos: vi.fn(),
    listAlerts: vi.fn(async () => alerts),
    getDefaultBranch: vi.fn(async () => "main"),
  } as unknown as GitHubService;
  const workspaces = {
    prepare: vi.fn(async (_o: string, _r: string, branch: string) => ({ dir: "/ws/octo/app", branch, baseSha: "base" })),
    run: vi.fn(async (_dir: string, args: string[]) => (args[0] === "log" ? "abc fix: nanoid\n" : "")),
    push: vi.fn(async () => {}),
  };
  const session = new AgentSession("octo", "app", [7], { github, workspaces, runQuery: fake.runQuery, model: "test-model" });
  const events: ServerEvent[] = [];
  session.subscribe((e) => events.push(e));
  return { session, events, workspaces, ...fake };
}

describe("AgentSession", () => {
  it("prepares the workspace, sends the initial prompt and streams events", async () => {
    const { session, events, prompts, getOptions } = setup([[delta("影響は"), delta("ありません"), result]]);
    const done = session.start();
    await vi.waitFor(() => expect(session.status).toBe("idle"));

    expect(prompts[0]).toContain("#7 [high] npm:lodash");
    expect(getOptions()).toMatchObject({ cwd: "/ws/octo/app", model: "test-model" });
    expect(session.info()).toMatchObject({ branch: "alertcure/fix-7", workspace: "/ws/octo/app" });
    expect(session.sdkSessionId).toBe("sdk-1");
    expect(events.map((e) => e.type)).toEqual([
      "status", // preparing
      "user_message",
      "status", // running
      "assistant_delta",
      "assistant_delta",
      "result",
      "status", // idle
    ]);

    session.close();
    await done;
    expect(session.status).toBe("closed");
  });

  it("replays merged history to late subscribers and accepts follow-up messages", async () => {
    const { session, prompts } = setup([[delta("a"), delta("b"), result], [delta("c"), result]]);
    void session.start();
    await vi.waitFor(() => expect(session.status).toBe("idle"));

    const replay: ServerEvent[] = [];
    session.subscribe((e) => replay.push(e));
    expect(replay.filter((e) => e.type === "assistant_delta")).toEqual([{ type: "assistant_delta", text: "ab" }]);

    session.send("続けて");
    await vi.waitFor(() => expect(prompts).toEqual([expect.any(String), "続けて"]));
    await vi.waitFor(() => expect(session.status).toBe("idle"));
    session.close();
  });

  it("allows safe tools, denies forbidden ones and asks the user for the rest", async () => {
    const { session, events, getOptions } = setup([[result]]);
    void session.start();
    await vi.waitFor(() => expect(getOptions()).toBeDefined());
    const canUseTool = getOptions()!.canUseTool!;
    const opts = (signal = new AbortController().signal) => ({ signal, toolUseID: "1" }) as never;

    expect((await canUseTool("Edit", { file_path: "/ws/octo/app/package.json" }, opts())).behavior).toBe("allow");
    expect((await canUseTool("Bash", { command: "git push --force" }, opts())).behavior).toBe("deny");

    // 承認する
    const approved = canUseTool("mcp__alertcure__create_pull_request", { title: "fix" }, opts());
    await vi.waitFor(() => expect(events.some((e) => e.type === "approval_request")).toBe(true));
    const request = events.find((e) => e.type === "approval_request")!;
    expect(request).toMatchObject({ title: "Pull Request を作成: fix", preview: expect.stringContaining("abc fix: nanoid") });
    session.respondApproval((request as { id: string }).id, true);
    expect(await approved).toMatchObject({ behavior: "allow", updatedInput: { title: "fix" } });
    expect(events).toContainEqual({ type: "approval_resolved", id: (request as { id: string }).id, approved: true });

    // 理由を付けて拒否する
    const denied = canUseTool("Bash", { command: "curl example.com" }, opts());
    await vi.waitFor(() => expect(events.filter((e) => e.type === "approval_request")).toHaveLength(2));
    const second = events.filter((e) => e.type === "approval_request")[1] as { id: string };
    session.respondApproval(second.id, false, "外部への通信はしない");
    expect(await denied).toEqual({ behavior: "deny", message: "ユーザーが拒否しました。理由: 外部への通信はしない" });

    // 中断されたら拒否として扱う
    const controller = new AbortController();
    const aborted = canUseTool("Bash", { command: "curl example.com" }, opts(controller.signal));
    await vi.waitFor(() => expect(events.filter((e) => e.type === "approval_request")).toHaveLength(3));
    controller.abort();
    expect((await aborted).behavior).toBe("deny");
    session.close();
  });

  it("reports an error when the selected alerts are no longer open", async () => {
    const { session, events } = setup([], []);
    await session.start();
    expect(session.status).toBe("error");
    expect(events).toContainEqual({ type: "error", message: expect.stringContaining("見つかりません") });
  });
});

describe("SessionManager", () => {
  it("refuses a second active session for the same repository", () => {
    const github = { listAlerts: vi.fn(() => new Promise(() => {})), getDefaultBranch: vi.fn(async () => "main") } as unknown as GitHubService;
    const workspaces = { prepare: vi.fn(() => new Promise<never>(() => {})), run: vi.fn(), push: vi.fn() };
    const manager = new SessionManager({ github, workspaces });
    const first = manager.create("octo", "app", [1]);
    expect(() => manager.create("octo", "app", [2])).toThrow(SessionConflictError);
    expect(manager.create("octo", "other", [1])).toBeDefined();
    first.close();
    expect(manager.create("octo", "app", [2])).toBeDefined();
    manager.closeAll();
  });

  it("names branches by sorted alert numbers", () => {
    expect(branchName([5, 2])).toBe("alertcure/fix-2-5");
  });
});
