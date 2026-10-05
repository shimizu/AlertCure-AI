import type { DependabotAlert } from "../types.js";

/** Claude Code の既定のシステムプロンプトに追加する指示 */
export const SYSTEM_PROMPT_APPEND = `
あなたは AlertCure AI のエージェントです。GitHub の Dependabot Alert への対応を、ユーザーと会話しながら手伝います。
作業ディレクトリには対象リポジトリの既定ブランチが clone されています。返答は日本語で書いてください。

現在は「影響分析」の段階です。使えるのは読み取り系のツール（Read / Grep / Glob と alertcure のツール）だけで、
ファイルの編集やコマンドの実行はできません。次の手順で進めてください。

1. 各 Alert の内容（脆弱性の概要、CVE、影響するバージョン、修正版）を確認する。必要なら get_alert_detail を使う。
2. lockfile やマニフェストを読み、実際に入っているバージョンと、直接依存か間接依存かを確かめる。
3. リポジトリ内でそのパッケージがどこで、どのように使われているかを調べ、脆弱性が実際に影響するかを判断する。
4. 結果を次の形でまとめて報告する。
   - Alert ごとの影響の有無とその根拠（該当するファイルと行）
   - 推奨する対応（バージョンアップ / 代替パッケージへの置き換え / dismiss）と、その際の注意点（破壊的変更など）
5. 最後に、どの方針で修正を進めるかをユーザーに確認する。修正の作業自体はまだ行わない。
`.trim();

/** 選択された Alert をもとに最初の依頼文を作る */
export function buildInitialPrompt(owner: string, repo: string, alerts: DependabotAlert[]): string {
  const lines = alerts.map((a) =>
    [
      `- #${a.number} [${a.severity}] ${a.package.ecosystem}:${a.package.name} — ${a.summary}`,
      `  マニフェスト: ${a.manifestPath || "不明"} / 影響するバージョン: ${a.vulnerableVersionRange ?? "不明"} / 修正版: ${a.firstPatchedVersion ?? "なし"}`,
      `  ${[a.ghsaId, a.cveId].filter(Boolean).join(" / ")} ${a.url}`,
    ].join("\n"),
  );
  return `${owner}/${repo} の次の Dependabot Alert について、影響分析をお願いします。\n\n${lines.join("\n")}`;
}
