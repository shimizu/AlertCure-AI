import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { classifyCommand } from "./bash.js";

export type PermissionDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string }
  /** ユーザーの承認が必要 */
  | { behavior: "ask"; reason: string };

/** 読み取り専用の組込ツールと、そのパスを表す入力項目 */
const READ_TOOLS: Record<string, string> = { Read: "file_path", Grep: "path", Glob: "path" };
const WRITE_TOOLS: Record<string, string> = { Edit: "file_path", Write: "file_path", NotebookEdit: "notebook_path" };

const MCP_PREFIX = "mcp__alertcure__";
const MCP_READ_TOOLS = new Set(["get_alerts", "get_alert_detail"]);
const MCP_APPROVAL_TOOLS: Record<string, string> = {
  create_pull_request: "ブランチを push して Pull Request を作成します",
  dismiss_alert: "Alert を dismiss します",
};

/**
 * シンボリックリンクをたどった実際のパスを返す。まだ存在しないパス（新規作成のファイル）は、
 * 存在する一番近い親ディレクトリまでをたどって残りをつなげる。
 */
export function realPath(path: string): string {
  let current = resolve(path);
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    rest.unshift(basename(current));
    current = parent;
  }
  return join(existsSync(current) ? realpathSync(current) : current, ...rest);
}

export function isInside(root: string, target: string): boolean {
  const realRoot = realPath(root);
  const rel = relative(realRoot, realPath(resolve(root, target)));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isGitInternal(root: string, target: string): boolean {
  const rel = relative(realPath(root), realPath(resolve(root, target)));
  return rel === ".git" || rel.startsWith(`.git/`);
}

/**
 * ツール呼び出しの判定（PreToolUse フックと canUseTool の両方から使う）。
 * - 自動で許可: 作業ディレクトリ内の読み取りと編集、許可リストにあるコマンド、Alert の参照
 * - 承認が必要: その他のコマンド、PR の作成、Alert の dismiss
 * - 常に拒否: 作業ディレクトリの外へのアクセス、.git の書き換え、git push
 */
export function decideToolUse(workspace: string, toolName: string, input: Record<string, unknown>): PermissionDecision {
  if (toolName.startsWith(MCP_PREFIX)) {
    const name = toolName.slice(MCP_PREFIX.length);
    if (MCP_READ_TOOLS.has(name)) return { behavior: "allow" };
    const reason = MCP_APPROVAL_TOOLS[name];
    if (reason) return { behavior: "ask", reason };
  }

  const readKey = READ_TOOLS[toolName];
  if (readKey) {
    const path = input[readKey];
    if (path === undefined || (typeof path === "string" && isInside(workspace, path))) return { behavior: "allow" };
    return { behavior: "deny", message: "作業ディレクトリの外にあるファイルは読み取れません。" };
  }

  const writeKey = WRITE_TOOLS[toolName];
  if (writeKey) {
    const path = input[writeKey];
    if (typeof path !== "string" || !isInside(workspace, path)) {
      return { behavior: "deny", message: "作業ディレクトリの外にあるファイルは編集できません。" };
    }
    // フックなどを書き換えると、承認なしで任意のコマンドを実行できてしまう
    if (isGitInternal(workspace, path)) return { behavior: "deny", message: ".git ディレクトリの中は編集できません。" };
    return { behavior: "allow" };
  }

  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    if (input.run_in_background === true) {
      return { behavior: "ask", reason: "バックグラウンドで実行するコマンド" };
    }
    const { decision, reason } = classifyCommand(command);
    if (decision === "deny") return { behavior: "deny", message: reason };
    return decision === "allow" ? { behavior: "allow" } : { behavior: "ask", reason };
  }

  return { behavior: "deny", message: `${toolName} は使えません。` };
}
