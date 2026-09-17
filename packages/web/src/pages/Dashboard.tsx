import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SEVERITY_LABEL, SeverityBar, SeverityCount, SEVERITY_STYLE } from "../components/Severity";
import { Button, Card, Notice, SortHeader, Spinner, Tag } from "../components/ui";
import { api } from "../lib/api";
import { formatRelative, numberFormat } from "../lib/format";
import {
  DEFAULT_REPO_FILTERS,
  filterRepos,
  sortRepos,
  sumAlerts,
  type RepoFilters,
  type RepoSort,
  type RepoSortKey,
} from "../lib/repoTable";
import { repoHref } from "../lib/router";
import { SEVERITY_ORDER, type RefreshStatus } from "../lib/types";

export function Dashboard() {
  const queryClient = useQueryClient();
  const reposQuery = useQuery({
    queryKey: ["repos"],
    queryFn: api.getRepos,
    // 取得中は進み具合を表示するため 1 秒ごとに問い合わせる
    refetchInterval: (query) => (query.state.data?.refresh.running ? 1000 : false),
  });
  const refresh = useMutation({
    mutationFn: api.refreshRepos,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos"] }),
  });

  const [filters, setFilters] = useState<RepoFilters>(DEFAULT_REPO_FILTERS);
  const [sort, setSort] = useState<RepoSort>({ key: "total", desc: true });

  const data = reposQuery.data;
  const allRepos = data?.repos ?? [];
  const visible = useMemo(() => sortRepos(filterRepos(allRepos, filters), sort), [allRepos, filters, sort]);
  const totals = useMemo(() => sumAlerts(visible), [visible]);
  const running = data?.refresh.running ?? false;

  const toggleSort = (key: RepoSortKey) =>
    setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== "name" }));
  const setFilter = <K extends keyof RepoFilters>(key: K, value: RepoFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">リポジトリ一覧</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            最終取得: {data?.fetchedAt ? formatRelative(data.fetchedAt) : "—"}
          </p>
        </div>
        <Button onClick={() => refresh.mutate()} disabled={running || refresh.isPending}>
          {running ? <Spinner /> : "↻"} 最新の情報を取得
        </Button>
      </div>

      {reposQuery.error && <Notice tone="error">{reposQuery.error.message}</Notice>}
      {data?.refresh.running && <RefreshProgress status={data.refresh} />}
      {data?.refresh.error && !running && (
        <Notice tone="error">
          <p className="font-medium">一覧の取得に失敗しました</p>
          <p className="mt-1">{data.refresh.error}</p>
        </Notice>
      )}

      {data?.repos && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Card className="px-4 py-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">表示中のリポジトリ</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {visible.length}
                <span className="ml-1 text-sm font-normal text-slate-400">/ {allRepos.length}</span>
              </p>
            </Card>
            <Card className="px-4 py-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">未対応の Alert</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{numberFormat.format(totals.total)}</p>
            </Card>
            {SEVERITY_ORDER.map((s) => (
              <Card key={s} className="px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className={`size-2 rounded-full ${SEVERITY_STYLE[s].bar}`} />
                  {SEVERITY_LABEL[s]}
                </p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${totals[s] ? SEVERITY_STYLE[s].text : "text-slate-300 dark:text-slate-600"}`}>
                  {numberFormat.format(totals[s])}
                </p>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <input
              type="search"
              placeholder="リポジトリ名で絞り込み"
              value={filters.query}
              onChange={(e) => setFilter("query", e.target.value)}
              className="w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 dark:border-slate-600 dark:bg-slate-800"
            />
            <Checkbox label="Alert があるものだけ" checked={filters.onlyWithAlerts} onChange={(v) => setFilter("onlyWithAlerts", v)} />
            <Checkbox label="アーカイブ済みを含める" checked={filters.includeArchived} onChange={(v) => setFilter("includeArchived", v)} />
            <Checkbox label="フォークを含める" checked={filters.includeForks} onChange={(v) => setFilter("includeForks", v)} />
            <select
              value={filters.visibility}
              onChange={(e) => setFilter("visibility", e.target.value as RepoFilters["visibility"])}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800"
            >
              <option value="all">公開・非公開</option>
              <option value="public">公開のみ</option>
              <option value="private">非公開のみ</option>
            </select>
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <SortHeader label="リポジトリ" align="left" active={sort.key === "name"} desc={sort.desc} onClick={() => toggleSort("name")} />
                  <th className="w-40 px-3 py-2 text-left font-medium">内訳</th>
                  {SEVERITY_ORDER.map((s) => (
                    <SortHeader key={s} label={SEVERITY_LABEL[s]} active={sort.key === s} desc={sort.desc} onClick={() => toggleSort(s)} />
                  ))}
                  <SortHeader label="合計" active={sort.key === "total"} desc={sort.desc} onClick={() => toggleSort("total")} />
                  <SortHeader label="最終 push" active={sort.key === "pushedAt"} desc={sort.desc} onClick={() => toggleSort("pushedAt")} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((repo) => (
                  <tr key={repo.fullName} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a href={repoHref(repo.owner, repo.name)} className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                          {repo.name}
                        </a>
                        {repo.isPrivate && <Tag>Private</Tag>}
                        {repo.isArchived && <Tag>Archived</Tag>}
                        {repo.isFork && <Tag>Fork</Tag>}
                      </div>
                      {repo.language && <p className="text-xs text-slate-400">{repo.language}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {repo.alertsEnabled ? (
                        <SeverityBar counts={repo.openAlerts} total={repo.openAlerts.total} />
                      ) : (
                        <span className="text-xs text-slate-400">Alert 無効</span>
                      )}
                    </td>
                    {SEVERITY_ORDER.map((s) => (
                      <td key={s} className="px-3 py-2 text-right tabular-nums">
                        <SeverityCount severity={s} count={repo.openAlerts[s]} />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{numberFormat.format(repo.openAlerts.total)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-slate-500 dark:text-slate-400">{formatRelative(repo.pushedAt)}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                      条件に合うリポジトリはありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function RefreshProgress({ status }: { status: RefreshStatus }) {
  const p = status.progress;
  // 一覧の取得と、Alert の多いリポジトリの集計をまとめて 1 本の進捗にする
  const steps = p?.reposTotal ? p.reposTotal + p.followUpsTotal : 0;
  const ratio = p && steps > 0 ? (p.repos + p.followUpsDone) / steps : null;
  return (
    <Notice tone="info">
      <div className="flex items-center gap-2 font-medium">
        <Spinner /> GitHub から取得しています（初回は 1 分以上かかることがあります）
      </div>
      <p className="mt-1 tabular-nums">
        リポジトリ {p?.repos ?? 0}
        {p?.reposTotal ? ` / ${p.reposTotal}` : ""} 件
        {p && p.followUpsTotal > 0 && ` ・ Alert の多いリポジトリの集計 ${p.followUpsDone} / ${p.followUpsTotal}`}
      </p>
      {ratio !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-900">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
    </Notice>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-600" />
      {label}
    </label>
  );
}
