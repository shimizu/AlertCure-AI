import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";

const execFileAsync = promisify(execFile);

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

/**
 * GitHub トークンを取得する。GITHUB_TOKEN があればそれを使い、
 * なければ `gh auth token` から取得する（トークンは保存しない）。
 */
export async function getGitHubToken(): Promise<string> {
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"]);
    const token = stdout.trim();
    if (token) return token;
  } catch {
    // 下で共通のエラーにする
  }
  throw new GitHubAuthError(
    "GitHub トークンを取得できません。`gh auth login` を実行するか GITHUB_TOKEN を設定してください。",
  );
}

export async function createOctokit(): Promise<Octokit> {
  return new Octokit({ auth: await getGitHubToken(), userAgent: "alertcure-ai" });
}
