import type { Cache } from "../db/cache.js";
import type { RepoSummary } from "../types.js";
import type { RepoFetchProgress } from "./repos.js";
import type { GitHubService } from "./service.js";

export const REPOS_CACHE_KEY = "repos";

export interface RefreshStatus {
  running: boolean;
  startedAt: string | null;
  progress: RepoFetchProgress | null;
  /** 直近の取得が失敗したときのメッセージ */
  error: string | null;
}

/**
 * リポジトリ一覧の取得は数十秒かかるため、バックグラウンドで実行して
 * 進み具合を問い合わせられるようにする。同時に実行されるのは 1 件だけ。
 */
export class RepoRefresher {
  private status: RefreshStatus = { running: false, startedAt: null, progress: null, error: null };
  private current: Promise<void> | null = null;

  constructor(
    private readonly github: GitHubService,
    private readonly cache: Cache,
  ) {}

  getStatus(): RefreshStatus {
    return { ...this.status, progress: this.status.progress && { ...this.status.progress } };
  }

  /** 取得を開始する（実行中なら何もしない）。完了を待つための Promise を返す */
  start(): Promise<void> {
    if (this.current) return this.current;
    this.status = { running: true, startedAt: new Date().toISOString(), progress: null, error: null };
    this.current = this.github
      .listRepos((progress) => {
        this.status.progress = progress;
      })
      .then((repos) => {
        this.cache.set<RepoSummary[]>(REPOS_CACHE_KEY, repos);
      })
      .catch((error: unknown) => {
        this.status.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.status.running = false;
        this.current = null;
      });
    return this.current;
  }
}
