import { isAbsolute, relative, resolve } from "node:path";

export type PermissionDecision = { behavior: "allow" } | { behavior: "deny"; message: string };

/** 読み取り専用の組込ツールと、そのパスを表す入力項目 */
const READ_TOOLS: Record<string, string> = { Read: "file_path", Grep: "path", Glob: "path" };

/** 影響分析の段階で使えるカスタムツール（createSdkMcpServer の name が alertcure） */
const READ_MCP_TOOLS = new Set(["mcp__alertcure__get_alerts", "mcp__alertcure__get_alert_detail"]);

export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(root, target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * canUseTool の判定。影響分析の段階（ステップ4）では読み取りだけを許可し、
 * 作業ディレクトリの外は読ませない。
 */
export function decideToolUse(workspace: string, toolName: string, input: Record<string, unknown>): PermissionDecision {
  if (READ_MCP_TOOLS.has(toolName)) return { behavior: "allow" };

  const pathKey = READ_TOOLS[toolName];
  if (pathKey) {
    const path = input[pathKey];
    if (path === undefined || (typeof path === "string" && isInside(workspace, path))) {
      return { behavior: "allow" };
    }
    return { behavior: "deny", message: "作業ディレクトリの外にあるファイルは読み取れません。" };
  }

  return {
    behavior: "deny",
    message: `現在は影響分析の段階のため、${toolName} は使えません。読み取り系のツールで調査を続けてください。`,
  };
}
