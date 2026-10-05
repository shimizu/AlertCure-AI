import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { getGitHubToken } from "../github/client.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_WORKSPACES_DIR = join(homedir(), ".alertcure", "workspaces");

export type GitRunner = (args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) => Promise<void>;

const runGit: GitRunner = async (args, { cwd, env }) => {
  await execFileAsync("git", args, { cwd, env, maxBuffer: 16 * 1024 * 1024 });
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
   * 初回は既定ブランチを浅く clone し、2回目以降は既定ブランチの最新に揃える。
   * 作業ディレクトリのパスを返す。
   */
  async prepare(owner: string, repo: string): Promise<string> {
    const dir = this.pathFor(owner, repo);
    const env = gitAuthEnv(await this.getToken());
    if (existsSync(join(dir, ".git"))) {
      await this.git(["fetch", "--depth", "1", "origin", "HEAD"], { cwd: dir, env });
      await this.git(["reset", "--hard", "FETCH_HEAD"], { cwd: dir, env });
    } else {
      await mkdir(dirname(dir), { recursive: true });
      await this.git(["clone", "--depth", "1", `https://github.com/${owner}/${repo}.git`, dir], { env });
    }
    return dir;
  }
}
