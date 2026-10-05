# AlertCure-AI 計画書 (plan.md)

## Context
GitHub の個人アカウント (shimizu) には、公開/非公開あわせて多数のリポジトリがあり、Dependabot Alert の状況を横断的に把握しにくい。
本ツールでは次の3つを実現する。
1. リポジトリ一覧と、Alert の件数（重大度別）を一画面で確認する
2. 対応したいリポジトリや Alert を選び、AI エージェントと会話しながら影響を分析して修正する
3. 依存関係の更新 → テスト → ブランチ push → PR 作成までをエージェントが行い、危険な操作の前には必ずユーザーの承認を挟む

決定事項: UI はローカル Web アプリ、エージェント基盤は Claude Agent SDK (TypeScript)、エージェントの作業範囲は修正から PR 作成まで、対象は個人アカウントのみ。

---

## アーキテクチャ全体像

```
┌──────────── Browser (React + Vite) ─────────────┐
│  RepoTable  │  AlertList  │  ChatPanel + 承認ダイアログ │
└──────┬─────────────── REST ──────┬── WebSocket ──┘
       │                           │ (ストリーミング / 承認要求)
┌──────▼───────────── Local Server (Node + Hono) ─▼──────────┐
│ GitHubService ─ Octokit (REST + GraphQL)                    │
│ AlertCache    ─ node:sqlite (取得結果をキャッシュ)           │
│ AgentSession  ─ @anthropic-ai/claude-agent-sdk query()      │
│   ├ カスタムMCPツール (createSdkMcpServer)                   │
│   │   get_alerts / get_alert_detail / prepare_workspace /   │
│   │   create_pull_request / dismiss_alert                   │
│   ├ 組込ツール: Read / Edit / Bash / Grep (作業ディレクトリ内に限定) │
│   └ canUseTool フック → WebSocket 経由でユーザーの承認を得る │
│ WorkspaceManager ─ ~/.alertcure/workspaces/<repo>/<branch>  │
└─────────────────────────────────────────────────────────────┘
        │ gh auth token で取得したトークン     │ ANTHROPIC_API_KEY
        ▼                                     ▼
     GitHub API                          Claude API
```

### 設計方針
- **ローカル専用**: サーバーは `127.0.0.1` のみで待ち受ける。GitHub トークンは `gh auth token` から実行時に取得し、ファイルには保存しない。
- **一覧取得は GraphQL を使う**: `viewer.repositories` に `vulnerabilityAlerts(states: OPEN)` を含めて問い合わせると、リポジトリ数が多くても数リクエストで件数が揃う。重大度別の件数は、各 Alert の `securityVulnerability.severity` を集計して求める。
- **Alert の詳細は REST を使う**: `GET /repos/{o}/{r}/dependabot/alerts` で取得する。Dependabot が無効なリポジトリで返る 403 は「無効」として表示する。
- **エージェントの作業はリポジトリごとに隔離する**: 作業用ディレクトリに clone（2回目以降は fetch）し、`alertcure/fix-<alert番号>` ブランチを作る。SDK の `cwd` をこのディレクトリに固定する。
- **承認の段階（`canUseTool` で制御）**
  - 自動で許可: 読み取り系 (Read/Grep/Glob)、作業ディレクトリ内の Edit、許可リストにあるコマンド (`npm install`, `npm test`, `pip`, `git status/diff/add/commit` など)
  - ユーザーの承認が必要: その他の Bash、`git push`、`create_pull_request`、`dismiss_alert`
  - 常に拒否: 作業ディレクトリの外への書き込み、`git push --force`、既定ブランチへの push
- **セッションの継続**: SDK のセッション ID を SQLite に保存し、`resume` で会話を再開できるようにする。

---

## 技術スタック
| 層 | 採用技術 |
|---|---|
| 言語/実行環境 | TypeScript / Node 26 (導入済み) |
| パッケージ構成 | npm workspaces（`server` と `web` の2パッケージ） |
| サーバー | Hono + `@hono/node-server` + `ws` |
| GitHub API | `@octokit/rest`, `@octokit/graphql` |
| エージェント | `@anthropic-ai/claude-agent-sdk`（モデル: `claude-opus-5-5`、`ALERTCURE_MODEL` で `claude-sonnet-5-5` などに切り替え可能） |
| DB | `node:sqlite`（Node 標準、追加の依存なし） |
| フロントエンド | React + Vite + TanStack Query / Table、スタイルは Tailwind |
| テスト | Vitest（GitHub API は msw でモック） |

---

## ディレクトリ構成（予定）
```
AlertCure-AI/
├ plan.md
├ package.json            # npm workspaces
├ packages/server/src/
│   ├ index.ts            # Hono 起動、REST と WebSocket のエンドポイント
│   ├ github/client.ts    # gh auth token を使った Octokit の生成
│   ├ github/repos.ts     # GraphQL でリポジトリ一覧と Alert 件数を取得
│   ├ github/alerts.ts    # REST で Alert の詳細取得、dismiss、PR 作成
│   ├ db/cache.ts         # node:sqlite によるキャッシュとセッション保存
│   ├ agent/session.ts    # query() のラッパー、ストリーム中継
│   ├ agent/tools.ts      # createSdkMcpServer で定義するカスタムツール
│   ├ agent/permissions.ts# canUseTool の判定ロジック
│   ├ agent/prompt.ts     # システムプロンプト（対応手順の定義）
│   └ workspace/manager.ts# clone、ブランチ作成、後片付け
└ packages/web/src/
    ├ pages/Dashboard.tsx # リポジトリ一覧表（件数・重大度・ソート・絞り込み）
    ├ pages/RepoDetail.tsx# Alert 一覧とチャット
    ├ components/ChatPanel.tsx
    └ components/ApprovalDialog.tsx
```

## API（サーバー側）
- `GET  /api/repos?refresh=1` … リポジトリ一覧と重大度別の件数
- `GET  /api/repos/:owner/:repo/alerts` … Alert の詳細一覧
- `POST /api/sessions` `{repo, alertNumbers[]}` … エージェントのセッションを開始
- `WS   /ws/sessions/:id` … サーバーからは `assistant_delta` / `tool_use` / `approval_request` / `result`、クライアントからは `user_message` / `approval_response` / `interrupt` を送る

## エージェントの対応手順（システムプロンプトで指示する）
1. Alert の内容（CVE、影響するバージョン、修正済みバージョン）と、リポジトリ内でそのパッケージがどう使われているかを調べ、影響分析をユーザーに報告する
2. 修正方針（バージョンアップ、代替パッケージへの置き換え、dismiss のいずれか）を提案し、ユーザーの合意を得る
3. 作業ディレクトリで lockfile を更新し、ビルドとテストを実行する。失敗した場合は修正を試み、改善しなければ報告する
4. 差分を要約してコミットし、承認を得たうえで push と PR 作成を行う（PR 本文には該当する Alert へのリンクを入れる）
5. 結果を報告し、Alert の一覧を再取得する

---

## 実装ステップ
1. **土台作り**: npm workspaces、TypeScript、Vitest、Hono と Vite の開発サーバーを用意する
2. **GitHub 連携**: `client.ts` / `repos.ts` / `alerts.ts` とキャッシュ、それぞれの単体テスト
3. **ダッシュボード UI**: リポジトリ一覧表（件数の降順、重大度ごとの色分け、アーカイブ済みの除外）と Alert 詳細画面
4. **エージェント連携**: `session.ts` と WebSocket による中継、チャット画面（まずは読み取り系ツールのみで影響分析まで）
5. **修正フロー**: 作業ディレクトリ管理、承認フック、承認ダイアログ、PR 作成と dismiss のツール
6. **仕上げ**: セッションの再開、エラー表示、README

## 検証方法
- `npm test`: GraphQL/REST のレスポンスをもとにした集計、403 の扱い、承認判定のテーブルテスト
- `npm run dev` でサーバーと画面を起動し、実アカウントで一覧が表示され、件数が `gh api` の結果と一致することを確認する
- Alert を持つテスト用の非公開リポジトリ（古い依存関係を入れたもの）を用意し、影響分析 → 修正 → テスト → 承認 → PR 作成まで一通り動くことを確認する
- 承認を拒否したとき、push や PR 作成が行われないことを確認する

## 前提・注意点
- `ANTHROPIC_API_KEY` の設定が必要
- 対象リポジトリのテストを実行するための言語環境（Node、Python など）は、ローカルに用意されている前提とする
- 最初のバージョンでは、Alert の件数を自動で定期更新しない（手動更新とキャッシュのみ）
