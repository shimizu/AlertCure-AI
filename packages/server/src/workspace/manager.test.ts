import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitAuthEnv, gitErrorMessage, WorkspaceManager, type GitRunner } from "./manager.js";

describe("WorkspaceManager", () => {
  let root: string;
  let git: ReturnType<typeof vi.fn<GitRunner>>;
  let manager: WorkspaceManager;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "alertcure-ws-"));
    git = vi.fn<GitRunner>(async (args) => (args[0] === "rev-parse" ? "abc123\n" : ""));
    manager = new WorkspaceManager({ root, git, getToken: async () => "tkn" });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("clones on first use and creates the work branch without exposing the token", async () => {
    const prepared = await manager.prepare("octo", "app", "alertcure/fix-2");
    const dir = join(root, "octo", "app");
    expect(prepared).toEqual({ dir, branch: "alertcure/fix-2", baseSha: "abc123" });
    expect(git.mock.calls.map(([args]) => args)).toEqual([
      ["clone", "--depth", "1", "https://github.com/octo/app.git", dir],
      ["checkout", "--force", "-B", "alertcure/fix-2", "HEAD"],
      ["clean", "-fd"],
      ["rev-parse", "HEAD"],
    ]);
    const [args, { env }] = git.mock.calls[0]!;
    expect(args.join(" ")).not.toContain("tkn");
    expect(env.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${Buffer.from("x-access-token:tkn").toString("base64")}`);
  });

  it("fetches an existing clone and branches from FETCH_HEAD", async () => {
    mkdirSync(join(root, "octo", "app", ".git"), { recursive: true });
    await manager.prepare("octo", "app", "alertcure/fix-2");
    expect(git.mock.calls.map(([args]) => args.slice(0, 2))).toEqual([
      ["fetch", "--depth"],
      ["checkout", "--force"],
      ["clean", "-fd"],
      ["rev-parse", "HEAD"],
    ]);
    expect(git.mock.calls[1]![0]).toContain("FETCH_HEAD");
  });

  it("pushes the branch without force", async () => {
    await manager.push("/ws", "alertcure/fix-2");
    const [args, { env }] = git.mock.calls[0]!;
    expect(args).toEqual(["push", "origin", "HEAD:refs/heads/alertcure/fix-2"]);
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
  });

  it("rejects names that would escape the workspace root", async () => {
    await expect(manager.prepare("..", "app", "b")).rejects.toThrow();
    await expect(manager.prepare("octo", "a/b", "b")).rejects.toThrow();
    expect(git).not.toHaveBeenCalled();
  });

  it("explains git failures", () => {
    expect(gitErrorMessage(["push"], { code: 1, stderr: "hint: a\n ! [rejected] non-fast-forward\n" })).toBe(
      "git push に失敗しました。\nhint: a\n ! [rejected] non-fast-forward",
    );
    expect(gitErrorMessage(["clone"], { code: "ENOENT" })).toContain("インストール");
  });

  it("disables interactive prompts", () => {
    expect(gitAuthEnv("t", {}).GIT_TERMINAL_PROMPT).toBe("0");
  });
});
