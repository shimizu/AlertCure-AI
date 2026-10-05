import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ChatPanel } from "../components/ChatPanel";
import { Card, Notice, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { repoHref } from "../lib/router";
import { useAgentSession } from "../lib/useAgentSession";

export function Session({ owner, repo, id }: { owner: string; repo: string; id: string }) {
  const infoQuery = useQuery({ queryKey: ["session", id], queryFn: () => api.getSession(id), retry: false });
  const { state, connected, send, interrupt } = useAgentSession(id, infoQuery.isSuccess);
  const info = infoQuery.data;

  // 作業ディレクトリは準備が終わってから決まるので、状態が変わったら取り直す
  const { refetch } = infoQuery;
  useEffect(() => {
    if (state.status) void refetch();
  }, [state.status, refetch]);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
      <div>
        <a href={repoHref(owner, repo)} className="text-sm text-indigo-700 hover:underline dark:text-indigo-300">
          ← {owner}/{repo} の Alert 一覧
        </a>
        <h1 className="mt-2 text-xl font-bold">エージェントと相談</h1>
        {info && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            対象の Alert:
            {info.alertNumbers.map((n) => (
              <a
                key={n}
                href={`https://github.com/${owner}/${repo}/security/dependabot/${n}`}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-slate-300 px-1.5 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
              >
                #{n}
              </a>
            ))}
            <span className="ml-2 text-xs">現在は影響分析のみ（ファイルの編集やコマンドの実行は行いません）</span>
          </p>
        )}
      </div>

      {infoQuery.isPending && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> セッションを読み込んでいます…
        </p>
      )}
      {infoQuery.error && <Notice tone="error">{infoQuery.error.message}</Notice>}
      {info && (
        <Card className="min-h-0 flex-1">
          <ChatPanel state={state} connected={connected} workspace={info.workspace} onSend={send} onInterrupt={interrupt} />
        </Card>
      )}
    </div>
  );
}
