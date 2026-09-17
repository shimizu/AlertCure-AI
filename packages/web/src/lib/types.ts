// サーバーと同じ型定義を使う（型のみ参照するため実行時の依存はない）
export type {
  AlertState,
  DependabotAlert,
  RepoSummary,
  Severity,
  SeverityCounts,
} from "../../../server/src/types";

import type { Severity } from "../../../server/src/types";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export interface RepoFetchProgress {
  repos: number;
  reposTotal: number | null;
  followUpsTotal: number;
  followUpsDone: number;
}

export interface RefreshStatus {
  running: boolean;
  startedAt: string | null;
  progress: RepoFetchProgress | null;
  error: string | null;
}
