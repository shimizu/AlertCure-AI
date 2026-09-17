import type { Octokit } from "@octokit/rest";
import { emptySeverityCounts, type RepoSummary } from "../types.js";
import { normalizeSeverity } from "./severity.js";

const ALERT_PAGE_SIZE = 100;
/**
 * 1 回の問い合わせで取得するリポジトリ数。Alert が多いと GitHub 側で
 * 約 10 秒のタイムアウト (502) になるため小さめにし、失敗時はさらに半分にして再試行する。
 */
const REPO_PAGE_SIZE = 20;
const MIN_REPO_PAGE_SIZE = 2;
/** Alert が 100 件を超えるリポジトリの追加取得を同時に何件まで行うか */
const FOLLOW_UP_CONCURRENCY = 8;

/**
 * totalCount は使わない。REST で取得できる件数と一致しないことがあるため、
 * 総数は全ページの Alert を重大度別に数えた合計とする。
 */
interface AlertConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: { securityVulnerability: { severity: string } | null }[];
}

interface RepoNode {
  name: string;
  owner: { login: string };
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  pushedAt: string | null;
  defaultBranchRef: { name: string } | null;
  primaryLanguage: { name: string } | null;
  hasVulnerabilityAlertsEnabled: boolean;
  vulnerabilityAlerts: AlertConnection;
}

interface ReposResponse {
  viewer: {
    repositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RepoNode[];
    };
  };
}

interface RepoAlertsResponse {
  repository: { vulnerabilityAlerts: AlertConnection } | null;
}

const ALERT_FIELDS = `
  pageInfo { hasNextPage endCursor }
  nodes { securityVulnerability { severity } }
`;

const REPOS_QUERY = `
  query Repos($cursor: String, $pageSize: Int!) {
    viewer {
      repositories(first: $pageSize, after: $cursor, ownerAffiliations: OWNER,
                   orderBy: { field: PUSHED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          owner { login }
          nameWithOwner
          url
          isPrivate
          isArchived
          isFork
          pushedAt
          defaultBranchRef { name }
          primaryLanguage { name }
          hasVulnerabilityAlertsEnabled
          vulnerabilityAlerts(states: OPEN, first: ${ALERT_PAGE_SIZE}) { ${ALERT_FIELDS} }
        }
      }
    }
  }
`;

const REPO_ALERTS_QUERY = `
  query RepoAlerts($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      vulnerabilityAlerts(states: OPEN, first: ${ALERT_PAGE_SIZE}, after: $cursor) { ${ALERT_FIELDS} }
    }
  }
`;

function addSeverities(summary: RepoSummary, conn: AlertConnection) {
  for (const node of conn.nodes) {
    if (!node.securityVulnerability) continue;
    summary.openAlerts[normalizeSeverity(node.securityVulnerability.severity)] += 1;
    summary.openAlerts.total += 1;
  }
}

function toSummary(node: RepoNode): RepoSummary {
  const summary: RepoSummary = {
    owner: node.owner.login,
    name: node.name,
    fullName: node.nameWithOwner,
    url: node.url,
    isPrivate: node.isPrivate,
    isArchived: node.isArchived,
    isFork: node.isFork,
    pushedAt: node.pushedAt,
    defaultBranch: node.defaultBranchRef?.name ?? null,
    language: node.primaryLanguage?.name ?? null,
    alertsEnabled: node.hasVulnerabilityAlertsEnabled,
    openAlerts: emptySeverityCounts(),
  };
  addSeverities(summary, node.vulnerabilityAlerts);
  return summary;
}

/** 最初の 100 件に続く Alert を取得し、重大度の集計に加える */
async function fetchRemainingSeverities(
  octokit: Octokit,
  summary: RepoSummary,
  cursor: string | null,
): Promise<void> {
  while (cursor) {
    const res = await octokit.graphql<RepoAlertsResponse>(REPO_ALERTS_QUERY, {
      owner: summary.owner,
      name: summary.name,
      cursor,
    });
    const conn = res.repository?.vulnerabilityAlerts;
    if (!conn) return;
    addSeverities(summary, conn);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  }
}

/** 同時実行数を制限しつつ、追加されたタスクをすぐに開始する */
function createLimiter(limit: number) {
  const queue: (() => void)[] = [];
  let active = 0;
  const next = () => {
    if (active >= limit) return;
    const start = queue.shift();
    if (start) start();
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
}

function isGatewayTimeout(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 502 || status === 504;
}

/** リポジトリ一覧をページ送りし、1 件ごとに onRepo を呼ぶ */
async function forEachRepo(
  octokit: Octokit,
  pageSize: number,
  onRepo: (node: RepoNode) => void,
): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    let res: ReposResponse;
    try {
      res = await octokit.graphql<ReposResponse>(REPOS_QUERY, { cursor, pageSize });
    } catch (error) {
      if (!isGatewayTimeout(error) || pageSize <= MIN_REPO_PAGE_SIZE) throw error;
      // 同じカーソルのまま件数を減らして再試行する
      pageSize = Math.max(MIN_REPO_PAGE_SIZE, Math.floor(pageSize / 2));
      continue;
    }
    const { nodes, pageInfo } = res.viewer.repositories;
    nodes.forEach(onRepo);
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) return;
    cursor = pageInfo.endCursor;
  }
}

/** 認証ユーザーが所有するリポジトリと、未対応 Alert の重大度別件数を取得する */
export async function fetchRepoSummaries(
  octokit: Octokit,
  pageSize: number = REPO_PAGE_SIZE,
): Promise<RepoSummary[]> {
  const summaries: RepoSummary[] = [];
  const limit = createLimiter(FOLLOW_UP_CONCURRENCY);
  // 一覧のページ送りと並行して、100 件を超える Alert の続きを取得する
  const followUps: Promise<void>[] = [];

  try {
    await forEachRepo(octokit, pageSize, (node) => {
      const summary = toSummary(node);
      summaries.push(summary);
      const { pageInfo } = node.vulnerabilityAlerts;
      if (pageInfo.hasNextPage) {
        followUps.push(limit(() => fetchRemainingSeverities(octokit, summary, pageInfo.endCursor)));
      }
    });
  } catch (error) {
    // 並行中の追加取得の失敗が未処理の reject にならないようにする
    for (const followUp of followUps) followUp.catch(() => {});
    throw error;
  }

  await Promise.all(followUps);
  return summaries;
}
