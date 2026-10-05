import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideToolUse } from "./permissions.js";

describe("decideToolUse", () => {
  let root: string;
  let ws: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "alertcure-perm-"));
    ws = join(root, "octo", "app");
    mkdirSync(join(ws, ".git"), { recursive: true });
    mkdirSync(join(root, "secret"));
    symlinkSync(join(root, "secret"), join(ws, "link-out"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const decide = (tool: string, input: Record<string, unknown>) => decideToolUse(ws, tool, input).behavior;

  it("allows reads and edits inside the workspace", () => {
    expect(decide("Read", { file_path: join(ws, "package.json") })).toBe("allow");
    expect(decide("Read", { file_path: "src/index.ts" })).toBe("allow");
    expect(decide("Grep", { pattern: "lodash" })).toBe("allow");
    expect(decide("Edit", { file_path: join(ws, "package.json") })).toBe("allow");
    expect(decide("Write", { file_path: join(ws, "new", "file.ts") })).toBe("allow");
  });

  it("denies access outside the workspace, including through symlinks", () => {
    expect(decide("Read", { file_path: "/etc/passwd" })).toBe("deny");
    expect(decide("Read", { file_path: join(ws, "..", "other") })).toBe("deny");
    expect(decide("Read", { file_path: `${ws}-evil/x` })).toBe("deny");
    expect(decide("Glob", { pattern: "**/*", path: root })).toBe("deny");
    expect(decide("Read", { file_path: join(ws, "link-out", "key") })).toBe("deny");
    expect(decide("Write", { file_path: join(ws, "link-out", "new.txt") })).toBe("deny");
    expect(decide("Edit", { file_path: "/tmp/x" })).toBe("deny");
  });

  it("protects the .git directory", () => {
    expect(decide("Write", { file_path: join(ws, ".git", "hooks", "pre-commit") })).toBe("deny");
    expect(decide("Edit", { file_path: join(ws, ".gitignore") })).toBe("allow");
  });

  it("classifies commands and custom tools", () => {
    expect(decide("Bash", { command: "npm test" })).toBe("allow");
    expect(decide("Bash", { command: "npm test", run_in_background: true })).toBe("ask");
    expect(decide("Bash", { command: "curl example.com" })).toBe("ask");
    expect(decide("Bash", { command: "git push origin HEAD" })).toBe("deny");
    expect(decide("mcp__alertcure__get_alerts", {})).toBe("allow");
    expect(decide("mcp__alertcure__create_pull_request", { title: "x" })).toBe("ask");
    expect(decide("mcp__alertcure__dismiss_alert", { number: 1 })).toBe("ask");
    expect(decide("mcp__other__create_pull_request", {})).toBe("deny");
    expect(decide("WebFetch", { url: "https://example.com" })).toBe("deny");
  });
});
