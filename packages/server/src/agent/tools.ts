import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { GitHubService } from "../github/service.js";
import type { DependabotAlert } from "../types.js";
import type { PreparedWorkspace, WorkspaceManager } from "../workspace/manager.js";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string) {
  return { ...json({ error: message }), isError: true };
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

export interface AlertToolsContext {
  github: GitHubService;
  workspaces: Pick<WorkspaceManager, "run" | "push">;
  owner: string;
  repo: string;
  /** このセッションで対応する Alert の番号 */
  alertNumbers: number[];
  workspace: PreparedWorkspace;
  defaultBranch: string;
  /** Alert の状態を変えたあとに呼ぶ（キャッシュの破棄など） */
  onAlertsChanged?: () => void;
}

/** PR 本文の末尾に、対象の Alert へのリンクを付ける */
export function pullRequestBody(body: string, owner: string, repo: string, alertNumbers: number[]): string {
  const links = alertNumbers.map((n) => `- https://github.com/${owner}/${repo}/security/dependabot/${n}`).join("\n");
  return `${body.trim()}\n\n---\n対象の Dependabot Alert:\n${links}`;
}

/** コミット済みであることを確かめてから push し、PR を作成する */
export async function openPullRequest(ctx: AlertToolsContext, { title, body }: { title: string; body: string }) {
  const { github, workspaces, owner, repo, workspace } = ctx;
  const status = await workspaces.run(workspace.dir, ["status", "--porcelain"]);
  if (status.trim()) return failure(`コミットされていない変更があります。先にコミットしてください。\n${status}`);
  const ahead = Number((await workspaces.run(workspace.dir, ["rev-list", "--count", `${workspace.baseSha}..HEAD`])).trim());
  if (!ahead) return failure("既定ブランチからのコミットがありません。");

  await workspaces.push(workspace.dir, workspace.branch);
  const pr = await github.createPullRequest({
    owner,
    repo,
    head: workspace.branch,
    base: ctx.defaultBranch,
    title,
    body: pullRequestBody(body, owner, repo, ctx.alertNumbers),
  });
  return json({ ...pr, branch: workspace.branch, commits: ahead });
}

/** エージェントが Alert を調べ、PR の作成や dismiss を行うためのカスタムツール */
export function createAlertTools(ctx: AlertToolsContext) {
  const { github, owner, repo, workspace } = ctx;
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
          if (!alert) return failure(`未対応の Alert #${number} は見つかりません。`);
          return json(alert);
        },
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "create_pull_request",
        `作業ブランチ ${workspace.branch} を push し、${ctx.defaultBranch} への Pull Request を作成する。` +
          "変更はすべてコミットしてから呼ぶこと。本文の末尾には対象の Alert へのリンクが自動で付く。実行前にユーザーの承認が必要。",
        {
          title: z.string().min(1).max(200).describe("PR のタイトル"),
          body: z.string().min(1).describe("PR の本文（Markdown）。変更内容、影響分析の要約、テスト結果を含める"),
        },
        async (params) => openPullRequest(ctx, params),
      ),
      tool(
        "dismiss_alert",
        "このセッションで対応中の Dependabot Alert を dismiss する。実行前にユーザーの承認が必要。",
        {
          number: z.number().int().positive().describe("Alert の番号"),
          reason: z
            .enum(["fix_started", "inaccurate", "no_bandwidth", "not_used", "tolerable_risk"])
            .describe("理由: fix_started=修正に着手済み, inaccurate=誤検知, no_bandwidth=対応の余力なし, not_used=脆弱なコードを使っていない, tolerable_risk=許容できるリスク"),
          comment: z.string().max(280).describe("dismiss の根拠（GitHub に記録される。280文字まで）"),
        },
        async ({ number, reason, comment }) => {
          if (!ctx.alertNumbers.includes(number)) return failure(`Alert #${number} はこのセッションの対象ではありません。`);
          const alert = await github.dismissAlert({ owner, repo, alertNumber: number, reason, comment });
          ctx.onAlertsChanged?.();
          return json({ number: alert.number, state: alert.state, url: alert.url });
        },
      ),
    ],
  });
}
