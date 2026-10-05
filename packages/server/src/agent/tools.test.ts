import { describe, expect, it, vi } from "vitest";
import type { GitHubService } from "../github/service.js";
import { openPullRequest, pullRequestBody, type AlertToolsContext } from "./tools.js";

function context(git: Record<string, string>) {
  const github = { createPullRequest: vi.fn(async () => ({ number: 10, url: "https://github.com/octo/app/pull/10" })) };
  const workspaces = {
    run: vi.fn(async (_dir: string, args: string[]) => git[args[0]!] ?? ""),
    push: vi.fn(async () => {}),
  };
  const ctx: AlertToolsContext = {
    github: github as unknown as GitHubService,
    workspaces,
    owner: "octo",
    repo: "app",
    alertNumbers: [2],
    workspace: { dir: "/ws", branch: "alertcure/fix-2", baseSha: "base" },
    defaultBranch: "main",
  };
  return { ctx, github, workspaces };
}

describe("openPullRequest", () => {
  it("pushes the branch and opens a PR against the default branch", async () => {
    const { ctx, github, workspaces } = context({ status: "", "rev-list": "1\n" });
    const result = await openPullRequest(ctx, { title: "fix: nanoid", body: "本文" });
    expect(result.isError).toBeUndefined();
    expect(workspaces.push).toHaveBeenCalledWith("/ws", "alertcure/fix-2");
    expect(github.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ head: "alertcure/fix-2", base: "main", title: "fix: nanoid" }),
    );
  });

  it("refuses when there are uncommitted changes or no commits", async () => {
    const dirty = context({ status: " M package.json\n", "rev-list": "1" });
    expect((await openPullRequest(dirty.ctx, { title: "t", body: "b" })).isError).toBe(true);
    const empty = context({ status: "", "rev-list": "0" });
    expect((await openPullRequest(empty.ctx, { title: "t", body: "b" })).isError).toBe(true);
    expect(dirty.workspaces.push).not.toHaveBeenCalled();
    expect(empty.workspaces.push).not.toHaveBeenCalled();
  });
});

describe("pullRequestBody", () => {
  it("links the target alerts", () => {
    expect(pullRequestBody("本文\n", "octo", "app", [2, 5])).toContain(
      "- https://github.com/octo/app/security/dependabot/2\n- https://github.com/octo/app/security/dependabot/5",
    );
  });
});
