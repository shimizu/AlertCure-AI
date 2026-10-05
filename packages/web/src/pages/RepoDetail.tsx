import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SEVERITY_LABEL, SEVERITY_STYLE, SeverityBadge } from "../components/Severity";
import { Button, Card, Notice, Spinner, Tag } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { countBySeverity, countPackages, filterAlerts, sortAlerts } from "../lib/alertTable";
import { formatDate, formatRelative, numberFormat } from "../lib/format";
import { sessionHref } from "../lib/router";
import { SEVERITY_ORDER, type AlertState, type DependabotAlert, type Severity } from "../lib/types";

const STATE_TABS: { state: AlertState; label: string }[] = [
  { state: "open", label: "未対応" },
  { state: "fixed", label: "修正済み" },
  { state: "dismissed", label: "却下" },
  { state: "auto_dismissed", label: "自動却下" },
];

export function RepoDetail({ owner, repo }: { owner: string; repo: string }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AlertState>("open");
  const [query, setQuery] = useState("");
  const [severities, setSeverities] = useState<Severity[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const alertsKey = ["alerts", owner, repo, state];
  const alertsQuery = useQuery({
    queryKey: alertsKey,
    queryFn: () => api.getAlerts(owner, repo, state),
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });
  const reposQuery = useQuery({ queryKey: ["repos"], queryFn: api.getRepos });
  const summary = reposQuery.data?.repos?.find((r) => r.owner === owner && r.name === repo);

  const alerts = alertsQuery.data?.alerts;
  const visible = useMemo(
    () => (alerts ? sortAlerts(filterAlerts(alerts, { query, severities })) : []),
    [alerts, query, severities],
  );
  const counts = useMemo(() => countBySeverity(alerts ?? []), [alerts]);

  const reload = async () => {
    setRefreshing(true);
    try {
      queryClient.setQueryData(alertsKey, await api.getAlerts(owner, repo, state, true));
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSeverity = (s: Severity) =>
    setSeverities((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  const toggleSelected = (n: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(n)) next.add(n);
      return next;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.number));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const a of visible) {
        if (allVisibleSelected) next.delete(a.number);
        else next.add(a.number);
      }
      return next;
    });

  const startSession = useMutation({
    mutationFn: () => api.createSession(owner, repo, [...selected].sort((a, b) => a - b)),
    onSuccess: (session) => {
      window.location.hash = sessionHref(owner, repo, session.id);
    },
  });

  const disabled = alertsQuery.error instanceof ApiError && alertsQuery.error.code === "alerts_disabled";

  return (
    <div className="space-y-5">
      <div>
        <a href="#/" className="text-sm text-indigo-700 hover:underline dark:text-indigo-300">
          ← リポジトリ一覧
        </a>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
              {owner}/{repo}
              {summary?.isPrivate && <Tag>Private</Tag>}
              {summary?.isArchived && <Tag>Archived</Tag>}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              <a
                href={`https://github.com/${owner}/${repo}/security/dependabot`}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                GitHub で開く ↗
              </a>
              {alertsQuery.data && <> ・ 最終取得: {formatRelative(alertsQuery.data.fetchedAt)}</>}
            </p>
          </div>
          <Button onClick={reload} disabled={refreshing || disabled}>
            {refreshing ? <Spinner /> : "↻"} 最新の情報を取得
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {STATE_TABS.map((tab) => (
          <button
            key={tab.state}
            type="button"
            onClick={() => {
              setState(tab.state);
              setSelected(new Set());
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              state === tab.state
                ? "border-indigo-600 font-semibold text-indigo-700 dark:text-indigo-300"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {disabled && <Notice tone="warning">このリポジトリでは Dependabot Alert が無効になっています。</Notice>}
      {alertsQuery.error && !disabled && <Notice tone="error">{alertsQuery.error.message}</Notice>}
      {alertsQuery.isPending && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Alert を取得しています…
        </p>
      )}

      {alerts && (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="search"
                placeholder="パッケージ名・CVE などで絞り込み"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 dark:border-slate-600 dark:bg-slate-800"
              />
              {SEVERITY_ORDER.map((s) => {
                const active = severities.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSeverity(s)}
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                      active
                        ? "border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
                        : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
                    }`}
                  >
                    <span className={`size-2 rounded-full ${SEVERITY_STYLE[s].bar}`} />
                    {SEVERITY_LABEL[s]} {counts[s]}
                  </button>
                );
              })}
              <span className="ml-auto text-xs text-slate-500">
                {visible.length} / {alerts.length} 件 ・ {countPackages(alerts)} パッケージ
              </span>
            </div>

            <Card className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="accent-indigo-600" aria-label="表示中の Alert をすべて選択" />
                    </th>
                    <th className="px-3 py-2 font-medium">重大度</th>
                    <th className="px-3 py-2 font-medium">パッケージ / 概要</th>
                    <th className="px-3 py-2 font-medium">影響するバージョン</th>
                    <th className="px-3 py-2 font-medium">修正版</th>
                    <th className="px-3 py-2 font-medium">依存</th>
                    <th className="px-3 py-2 text-right font-medium">検出日</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visible.map((alert) => (
                    <AlertRow key={alert.number} alert={alert} selected={selected.has(alert.number)} onToggle={() => toggleSelected(alert.number)} />
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-slate-400">
                        {alerts.length === 0 ? "Alert はありません" : "条件に合う Alert はありません"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="h-fit space-y-3 p-4 lg:sticky lg:top-4">
            <h2 className="font-semibold">エージェントで対応</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              対応したい Alert を選んで、エージェントに影響分析と修正を依頼します。
            </p>
            <p className="text-sm">
              選択中: <span className="font-semibold tabular-nums">{numberFormat.format(selected.size)}</span> 件
            </p>
            <Button
              variant="primary"
              className="w-full justify-center"
              disabled={state !== "open" || selected.size === 0 || startSession.isPending}
              onClick={() => startSession.mutate()}
            >
              {startSession.isPending && <Spinner />} エージェントと相談する
            </Button>
            {state !== "open" && <p className="text-xs text-slate-500">未対応の Alert を選んでください。</p>}
            {startSession.error && <Notice tone="error">{startSession.error.message}</Notice>}
          </Card>
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert, selected, onToggle }: { alert: DependabotAlert; selected: boolean; onToggle: () => void }) {
  return (
    <tr className={selected ? "bg-indigo-50/60 dark:bg-indigo-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}>
      <td className="px-3 py-2 align-top">
        <input type="checkbox" checked={selected} onChange={onToggle} className="accent-indigo-600" aria-label={`Alert #${alert.number} を選択`} />
      </td>
      <td className="px-3 py-2 align-top">
        <SeverityBadge severity={alert.severity} />
        {alert.cvssScore ? <p className="mt-1 text-xs text-slate-400 tabular-nums">CVSS {alert.cvssScore.toFixed(1)}</p> : null}
      </td>
      <td className="px-3 py-2 align-top">
        <p className="font-medium">
          {alert.package.name}
          <span className="ml-1.5 text-xs font-normal text-slate-400">{alert.package.ecosystem}</span>
        </p>
        <p className="mt-0.5 text-slate-600 dark:text-slate-300">{alert.summary}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-400">
          <a href={alert.url} target="_blank" rel="noreferrer" className="hover:underline">
            #{alert.number}
          </a>
          <a href={`https://github.com/advisories/${alert.ghsaId}`} target="_blank" rel="noreferrer" className="hover:underline">
            {alert.ghsaId}
          </a>
          {alert.cveId && <span>{alert.cveId}</span>}
          <span>{alert.manifestPath}</span>
        </p>
      </td>
      <td className="px-3 py-2 align-top font-mono text-xs whitespace-nowrap">{alert.vulnerableVersionRange ?? "—"}</td>
      <td className="px-3 py-2 align-top font-mono text-xs whitespace-nowrap">
        {alert.firstPatchedVersion ?? <span className="font-sans text-slate-400">なし</span>}
      </td>
      <td className="px-3 py-2 align-top text-xs whitespace-nowrap text-slate-500 dark:text-slate-400">
        {alert.relationship === "direct" ? "直接" : alert.relationship === "transitive" ? "間接" : "—"}
        {alert.scope === "development" && <p>開発用</p>}
      </td>
      <td className="px-3 py-2 text-right align-top text-xs whitespace-nowrap text-slate-500 dark:text-slate-400">
        {formatDate(alert.createdAt)}
      </td>
    </tr>
  );
}
