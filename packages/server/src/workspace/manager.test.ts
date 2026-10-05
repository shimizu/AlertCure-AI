import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitAuthEnv, WorkspaceManager, type GitRunner } from "./manager.js";

describe("WorkspaceManager", () => {
  let root: string;
  let git: ReturnType<typeof vi.fn<GitRunner>>;
  let manager: WorkspaceManager;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "alertcure-ws-"));
    git = vi.fn<GitRunner>(async () => {});
    manager = new WorkspaceManager({ root, git, getToken: async () => "tkn" });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("clones on first use without putting the token in the arguments", async () => {
    const dir = await manager.prepare("octo", "app");
    expect(dir).toBe(join(root, "octo", "app"));
    const [args, { env }] = git.mock.calls[0]!;
    expect(args).toEqual(["clone", "--depth", "1", "https://github.com/octo/app.git", dir]);
    expect(args.join(" ")).not.toContain("tkn");
    expect(env.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${Buffer.from("x-access-token:tkn").toString("base64")}`);
  });

  it("fetches and resets an existing clone", async () => {
    mkdirSync(join(root, "octo", "app", ".git"), { recursive: true });
    await manager.prepare("octo", "app");
    expect(git.mock.calls.map(([args]) => args[0])).toEqual(["fetch", "reset"]);
  });

  it("rejects names that would escape the workspace root", async () => {
    await expect(manager.prepare("..", "app")).rejects.toThrow();
    await expect(manager.prepare("octo", "a/b")).rejects.toThrow();
    expect(git).not.toHaveBeenCalled();
  });

  it("disables interactive prompts", () => {
    expect(gitAuthEnv("t", {}).GIT_TERMINAL_PROMPT).toBe("0");
  });
});
