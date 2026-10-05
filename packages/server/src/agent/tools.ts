import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { GitHubService } from "../github/service.js";
import type { DependabotAlert } from "../types.js";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function brief(alert: DependabotAlert) {
  return {
    number: alert.number,
    severity: alert.severity,
    package: `${alert.package.ecosystem}:${alert.package.name}`,
    manifestPath: alert.manifestPath,
    summary: alert.summary,
    firstPatchedVersion: alert.firstPatchedVersion,
  };
}

/** エージェントが対象リポジトリの Alert を調べるためのカスタムツール */
export function createAlertTools(github: GitHubService, owner: string, repo: string) {
  return createSdkMcpServer({
    name: "alertcure",
    version: "0.1.0",
    tools: [
      tool(
        "get_alerts",
        `${owner}/${repo} の未対応の Dependabot Alert を一覧で返す`,
        {},
        async () => json((await github.listAlerts(owner, repo, "open")).map(brief)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "get_alert_detail",
        `${owner}/${repo} の Dependabot Alert を番号で指定して詳細を返す（CVE、影響するバージョン、修正版など）`,
        { number: z.number().int().positive().describe("Alert の番号") },
        async ({ number }) => {
          const alerts = await github.listAlerts(owner, repo, "open");
          const alert = alerts.find((a) => a.number === number);
          if (!alert) return { ...json({ error: `未対応の Alert #${number} は見つかりません。` }), isError: true };
          return json(alert);
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
}
