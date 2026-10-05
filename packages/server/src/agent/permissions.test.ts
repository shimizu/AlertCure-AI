import { describe, expect, it } from "vitest";
import { decideToolUse } from "./permissions.js";

const ws = "/home/me/.alertcure/workspaces/octo/app";

describe("decideToolUse", () => {
  it.each([
    ["Read", { file_path: `${ws}/package.json` }, "allow"],
    ["Read", { file_path: "src/index.ts" }, "allow"],
    ["Read", { file_path: "/etc/passwd" }, "deny"],
    ["Read", { file_path: `${ws}/../other/secret` }, "deny"],
    ["Read", { file_path: `${ws}-evil/x` }, "deny"],
    ["Grep", { pattern: "lodash" }, "allow"],
    ["Grep", { pattern: "x", path: ws }, "allow"],
    ["Glob", { pattern: "**/*", path: "/home/me" }, "deny"],
    ["mcp__alertcure__get_alerts", {}, "allow"],
    ["mcp__alertcure__get_alert_detail", { number: 3 }, "allow"],
    ["Edit", { file_path: `${ws}/package.json` }, "deny"],
    ["Bash", { command: "npm test" }, "deny"],
    ["mcp__other__get_alerts", {}, "deny"],
  ] as const)("%s %j → %s", (tool, input, expected) => {
    expect(decideToolUse(ws, tool, input).behavior).toBe(expected);
  });
});
