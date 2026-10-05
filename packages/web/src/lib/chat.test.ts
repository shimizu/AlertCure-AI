import { describe, expect, it } from "vitest";
import { chatReducer, describeTool, initialChatState, pendingApprovals, type ChatAction } from "./chat";

const run = (actions: ChatAction[]) => actions.reduce(chatReducer, initialChatState);

describe("chatReducer", () => {
  it("joins consecutive deltas and splits them around tool calls", () => {
    const state = run([
      { type: "user_message", text: "分析して" },
      { type: "assistant_delta", text: "調べ" },
      { type: "assistant_delta", text: "ます" },
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } },
      { type: "tool_result", toolUseId: "t1", isError: false, content: "body" },
      { type: "assistant_delta", text: "影響なし" },
    ]);
    expect(state.items).toEqual([
      { kind: "user", text: "分析して" },
      { kind: "assistant", text: "調べます" },
      { kind: "tool", id: "t1", name: "Read", input: { file_path: "a" }, result: { isError: false, content: "body" } },
      { kind: "assistant", text: "影響なし" },
    ]);
  });

  it("tracks status, cumulative cost and resets on reconnect", () => {
    const state = run([
      { type: "status", status: "preparing", detail: "準備中" },
      { type: "status", status: "idle" },
      { type: "result", isError: false, costUsd: 0.3, durationMs: 1000, numTurns: 3 },
    ]);
    expect(state.status).toBe("idle");
    expect(state.statusDetail).toBeNull();
    expect(state.costUsd).toBe(0.3);
    expect(chatReducer(state, { type: "reset" })).toEqual(initialChatState);
  });
});

describe("approvals", () => {
  it("tracks pending approvals until they are resolved", () => {
    const request = (id: string): ChatAction => ({ type: "approval_request", id, toolName: "Bash", title: "t", reason: "r", input: {}, preview: null });
    const state = run([request("a"), request("b"), { type: "approval_resolved", id: "a", approved: true }]);
    expect(pendingApprovals(state).map((a) => a.id)).toEqual(["b"]);
    expect(state.items[0]).toMatchObject({ kind: "approval", id: "a", approved: true });
  });
});

describe("describeTool", () => {
  it("shows paths relative to the workspace", () => {
    expect(describeTool("Read", { file_path: "/ws/app/src/a.ts" }, "/ws/app")).toEqual({ label: "ファイルを読む", detail: "src/a.ts" });
    expect(describeTool("mcp__alertcure__get_alert_detail", { number: 4 }).detail).toBe("#4");
  });
});
