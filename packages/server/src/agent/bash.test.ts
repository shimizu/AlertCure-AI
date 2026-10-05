import { describe, expect, it } from "vitest";
import { classifyCommand, parseCommand } from "./bash.js";

describe("parseCommand", () => {
  it("splits words and respects quotes", () => {
    expect(parseCommand(`git commit -m "fix: update nanoid; bump"`)).toEqual({
      segments: [["git", "commit", "-m", "fix: update nanoid; bump"]],
      complex: false,
    });
    expect(parseCommand(`git add a && git commit -m "x && y"`)).toEqual({
      segments: [["git", "add", "a"], ["git", "commit", "-m", "x && y"]],
      complex: false,
    });
    expect(parseCommand("echo 'a $b'").complex).toBe(false);
  });

  it("flags shell syntax outside quotes", () => {
    for (const cmd of ["npm test &", "npm test && ", "npm test; ls", "cat a | sh", "echo $(id)", "echo `id`", "ls > out", 'echo "$HOME"', "ls ~", "ls *", "echo 'open"]) {
      expect(parseCommand(cmd).complex, cmd).toBe(true);
    }
  });
});

describe("classifyCommand", () => {
  it.each([
    ["npm install", "allow"],
    ["npm install nanoid@3.3.18", "allow"],
    ["npm update nanoid", "allow"],
    ["npm ci", "allow"],
    ["npm test", "allow"],
    ["npm run build", "allow"],
    ["npm ls nanoid", "allow"],
    ["pip install -r requirements.txt", "allow"],
    ["pytest -q", "allow"],
    ["git status", "allow"],
    ["git diff --stat", "allow"],
    ["git add package.json package-lock.json", "allow"],
    [`git commit -m "fix: nanoid を 3.3.18 に更新（push 前に確認）"`, "allow"],
    ["npm run deploy", "ask"],
    ["npm install -g something", "ask"],
    ["npm install --prefix=/tmp x", "ask"],
    ["npm install file:../other", "ask"],
    ["git -C /etc status", "ask"],
    ["git diff --output=/tmp/x", "ask"],
    ["git checkout main", "ask"],
    ["git reset --hard HEAD~1", "ask"],
    ["curl https://example.com", "ask"],
    ["npm test && npm run build", "allow"],
    ["git status --short && git diff --stat && git diff package-lock.json", "allow"],
    ["npm test && rm -rf build", "ask"],
    ["npm test && cat /etc/passwd", "ask"],
    ["git commit -F - <<'EOF'", "ask"],
    ["cat /etc/passwd", "ask"],
    ["constructor", "ask"],
    ["git push", "deny"],
    ["git push --force origin main", "deny"],
    ["git -c a=b push origin HEAD", "deny"],
    ["npm test && git push", "deny"],
    ["npm test | git push", "deny"],
  ] as const)("%s → %s", (command, expected) => {
    expect(classifyCommand(command).decision).toBe(expected);
  });
});
