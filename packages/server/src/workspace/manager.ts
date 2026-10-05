import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { getGitHubToken } from "../github/client.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_WORKSPACES_DIR = join(homedir(), ".alertcure", "workspaces");

/** git を実行して標準出力を返す */
export type GitRunner = (args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) => Promise<string>;

/** git の失敗を、どのコマンドで何が起きたかがわかるメッセージにする */
export function gitErrorMessage(args: string[], error: { code?: unknown; stderr?: unknown; message?: string }): string {
  if (error.code === "ENOENT") return "git コマンドが見つかりません。git をインストールしてください。";
  const stderr = typeof error.stderr === "string" ? error.stderr.trim().split("\n").slice(-3).join("\n") : "";
  return `git ${args[0]} に失敗しました。${stderr ? `\n${stderr}` : ""}`;
}

const runGit: GitRunner = async (args, { cwd, env }) => {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, env, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw new Error(gitErrorMessage(args, error as { code?: unknown; stderr?: unknown }));
  }
};

/** 名前に使えない文字を含むリポジトリ名でディレクトリの外へ出ないようにする */
function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`不正なリポジトリ名です: ${value}`);
  }
  return value;
}

/**
 * トークンは環境変数経由の git 設定で渡す。
 * コマンドライン引数（ps で見える）や .git/config（ディスクに残る）には書かない。
 */
export function gitAuthEnv(token: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

export interface PreparedWorkspace {
  dir: string;
  branch: string;
  /** 作業ブランチの起点になった既定ブランチのコミット */
  baseSha: string;
}

export interface WorkspaceManagerOptions {
  root?: string;
  git?: GitRunner;
  getToken?: () => Promise<string>;
}

/** エージェントが作業するリポジトリの clone を ~/.alertcure/workspaces/<owner>/<repo> に用意する */
export class WorkspaceManager {
  private readonly root: string;
  private readonly git: GitRunner;
  private readonly getToken: () => Promise<string>;

  constructor({ root = process.env.ALERTCURE_WORKSPACES ?? DEFAULT_WORKSPACES_DIR, git = runGit, getToken = getGitHubToken }: WorkspaceManagerOptions = {}) {
    this.root = root;
    this.git = git;
    this.getToken = getToken;
  }

  pathFor(owner: string, repo: string): string {
    return join(this.root, safeSegment(owner), safeSegment(repo));
  }

  /**
   * 既定ブランチの最新から作業ブランチを作り直す。初回は浅く clone する。
   * 前回のセッションで残った変更や追跡されていないファイルは捨てる（node_modules など ignore 対象は残す）。
   */
  async prepare(owner: string, repo: string, branch: string): Promise<PreparedWorkspace> {
    const dir = this.pathFor(owner, repo);
    const env = gitAuthEnv(await this.getToken());
    // clone 直後は HEAD が、既存の clone では fetch した FETCH_HEAD が既定ブランチの最新を指す
    let start = "FETCH_HEAD";
    if (existsSync(join(dir, ".git"))) {
      await this.git(["fetch", "--depth", "1", "origin", "HEAD"], { cwd: dir, env });
    } else {
      await mkdir(dirname(dir), { recursive: true });
      await this.git(["clone", "--depth", "1", `https://github.com/${owner}/${repo}.git`, dir], { env });
      start = "HEAD";
    }
    await this.git(["checkout", "--force", "-B", branch, start], { cwd: dir, env });
    await this.git(["clean", "-fd"], { cwd: dir, env });
    const baseSha = (await this.git(["rev-parse", "HEAD"], { cwd: dir, env })).trim();
    return { dir, branch, baseSha };
  }

  /** 認証の要らない git コマンドを実行する（差分の確認など） */
  async run(dir: string, args: string[]): Promise<string> {
    return this.git(args, { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  }

  /** 作業ブランチを push する。強制 push は行わない */
  async push(dir: string, branch: string): Promise<void> {
    const env = gitAuthEnv(await this.getToken());
    await this.git(["push", "origin", `HEAD:refs/heads/${branch}`], { cwd: dir, env });
  }
}
