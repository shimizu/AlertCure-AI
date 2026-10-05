# AlertCure AI

GitHub の個人アカウントにあるリポジトリの Dependabot Alert を一覧で確認し、AI エージェントと会話しながら影響分析と修正を進めるローカル Web アプリです。
エージェントは依存関係の更新、ビルドやテストによる確認、コミット、Pull Request の作成までを行います。危険な操作の前には、必ずユーザーの承認を求めます。

## 必要なもの

- Node.js 24 以上
- git
- [GitHub CLI](https://cli.github.com/)（`gh auth login` 済み）または環境変数 `GITHUB_TOKEN`
  - Dependabot Alert の読み取りと dismiss、リポジトリへの push、Pull Request の作成ができる権限が必要です
- Claude API の API キー（`ANTHROPIC_API_KEY`）
- 修正の対象リポジトリでビルドやテストを実行するための言語環境（Node.js、Python など）

## セットアップと起動

```sh
npm install
cp .env.example .env   # ANTHROPIC_API_KEY を設定する
npm run dev
```

ブラウザで http://127.0.0.1:5173 を開きます。サーバーは http://127.0.0.1:8787 で待ち受けます（どちらも自分の PC からだけ接続できます）。

### 環境変数

| 変数 | 説明 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API のキー（必須） |
| `GITHUB_TOKEN` | GitHub のトークン。未設定のときは `gh auth token` から取得し、ファイルには保存しません |
| `ALERTCURE_MODEL` | エージェントのモデル。既定は `claude-opus-5-5` |
| `PORT` | サーバーのポート。既定は `8787` |
| `ALERTCURE_DB` | SQLite のパス。既定は `~/.alertcure/alertcure.sqlite` |
| `ALERTCURE_WORKSPACES` | 作業ディレクトリの置き場所。既定は `~/.alertcure/workspaces` |

## 使い方

1. **リポジトリ一覧**: 初回はリポジトリと Alert の件数の取得に数十秒かかります。結果はキャッシュされ、「最新の情報を取得」で取り直せます（件数は自動では更新されません）。
2. **Alert の一覧**: リポジトリを開き、対応したい未対応の Alert を選んで「エージェントと相談する」を押します。
3. **影響分析**: エージェントがリポジトリを clone し、脆弱性が実際に影響するかを調べて報告します。最後に対応方針（バージョンアップ / 置き換え / dismiss）を確認してきます。
4. **修正**: 方針を返信すると、エージェントが依存関係を更新し、ビルドやテストで確認してからコミットします。
5. **PR の作成または dismiss**: 承認ダイアログでコミットと変更されたファイルを確認し、承認すると push と PR の作成が行われます。

サーバーを再起動しても、会話はリポジトリ画面の「これまでのセッション」から開けます。メッセージを送ると続きから再開します。

## エージェントに許可している操作

すべてのツール呼び出しを、次の規則で判定しています（`packages/server/src/agent/permissions.ts`、`bash.ts`）。

| 扱い | 操作 |
|---|---|
| 自動で許可 | 作業ディレクトリ内のファイルの読み取りと編集、許可リストにあるコマンド（`npm install` / `npm test` / `npm run build`、`pip install`、`pytest`、`git status` / `diff` / `add` / `commit` など。`&&` でつないでいても、すべて許可リストにあれば許可） |
| 承認が必要 | 上記以外のコマンド（パイプ、リダイレクト、`-g` などを含むものも）、Pull Request の作成（push を含む）、Alert の dismiss |
| 常に拒否 | 作業ディレクトリの外へのアクセス（シンボリックリンク経由を含む）、`.git` ディレクトリ内の編集、`git push`（push は PR 作成ツールだけが、強制せずに行います） |

**注意:** エージェントはファイルの編集と `npm test` などの実行を承認なしで行えます。つまり、対象リポジトリのテストやビルドスクリプトを通じて、**手元の PC でコードを実行できます**。自分が管理していて、内容を信頼できるリポジトリにだけ使ってください。

## 仕組み

```
Browser (React + Vite) ── REST / WebSocket ──▶ Local Server (Hono)
                                                ├ GitHub API（Octokit: 一覧は GraphQL、Alert は REST）
                                                ├ SQLite（取得結果のキャッシュ、セッションの保存）
                                                └ Claude Agent SDK（query()、カスタムツール、承認フック）
                                                     └ 作業ディレクトリ ~/.alertcure/workspaces/<owner>/<repo>
```

- 作業ディレクトリでは、セッションごとに既定ブランチの最新から `alertcure/fix-<Alert番号>` ブランチを作り直します。前回の未コミットの変更は破棄されます（`node_modules` など ignore 対象は残ります）。
- 同じリポジトリで同時に進められるセッションは 1 つだけです。新しく始めるときは、前のセッションを「セッションを終了」で閉じてください。
- 会話の内容は Claude Agent SDK によって `~/.claude/projects/` にも保存されます。

## 開発

```sh
npm test          # Vitest（server と web）
npm run typecheck
npm run build
```

| パス | 内容 |
|---|---|
| `packages/server/src/github/` | リポジトリ一覧、Alert、PR、dismiss の GitHub API |
| `packages/server/src/agent/` | エージェントのセッション、カスタムツール、権限判定、システムプロンプト |
| `packages/server/src/workspace/` | clone、作業ブランチ、push |
| `packages/server/src/db/` | キャッシュとセッションの保存 |
| `packages/web/src/pages/` | ダッシュボード、Alert 一覧、セッション（チャット）画面 |
