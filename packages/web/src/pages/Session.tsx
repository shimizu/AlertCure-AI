import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApprovalDialog } from "../components/ApprovalDialog";
import { ChatPanel } from "../components/ChatPanel";
import { Button, Card, Notice, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { pendingApprovals } from "../lib/chat";
import { repoHref } from "../lib/router";
import { useAgentSession } from "../lib/useAgentSession";

export function Session({ owner, repo, id }: { owner: string; repo: string; id: string }) {
  const infoQuery = useQuery({ queryKey: ["session", id], queryFn: () => api.getSession(id), retry: false });
  const { state, connected, send, interrupt, respondApproval } = useAgentSession(id, infoQuery.isSuccess);
  const info = infoQuery.data;
  const pending = pendingApprovals(state);
  const ended = state.status === "closed" || state.status === "error";

  // 作業ディレクトリは準備が終わってから決まるので、状態が変わったら取り直す
  const { refetch } = infoQuery;
  useEffect(() => {
    if (state.status) void refetch();
  }, [state.status, refetch]);

  const closeSession = useMutation({ mutationFn: () => api.closeSession(id) });
  const onClose = () => {
    if (window.confirm("セッションを終了しますか？ 会話は再開できません（作業ブランチは手元に残ります）。")) closeSession.mutate();
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
      <div>
        <a href={repoHref(owner, repo)} className="text-sm text-indigo-700 hover:underline dark:text-indigo-300">
          ← {owner}/{repo} の Alert 一覧
        </a>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">エージェントと相談</h1>
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
                <span className="ml-2">
                  作業ブランチ: <code className="text-xs">{info.branch}</code>
                </span>
              </p>
            )}
          </div>
          {info && !ended && (
            <Button onClick={onClose} disabled={closeSession.isPending}>
              セッションを終了
            </Button>
          )}
        </div>
      </div>

      {infoQuery.isPending && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> セッションを読み込んでいます…
        </p>
      )}
      {infoQuery.error && <Notice tone="error">{infoQuery.error.message}</Notice>}
      {closeSession.error && <Notice tone="error">{closeSession.error.message}</Notice>}
      {info && (
        <Card className="min-h-0 flex-1">
          <ChatPanel state={state} connected={connected} workspace={info.workspace} onSend={send} onInterrupt={interrupt} />
        </Card>
      )}
      {pending[0] && connected && (
        <ApprovalDialog
          key={pending[0].id}
          approval={pending[0]}
          remaining={pending.length - 1}
          onRespond={(approved, message) => respondApproval(pending[0]!.id, approved, message)}
        />
      )}
    </div>
  );
}
