import { useState, type ReactNode } from "react";
import type { ChatItem } from "../lib/chat";
import { Button } from "./ui";

type Approval = Extract<ChatItem, { kind: "approval" }>;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      {children}
    </div>
  );
}

const PRE = "max-h-60 overflow-auto rounded-md bg-slate-100 p-3 font-mono text-xs whitespace-pre-wrap dark:bg-slate-800";

function Details({ approval }: { approval: Approval }) {
  const input = (approval.input ?? {}) as Record<string, unknown>;
  switch (approval.toolName) {
    case "Bash":
      return (
        <Field label="コマンド">
          <pre className={PRE}>{String(input.command ?? "")}</pre>
        </Field>
      );
    case "mcp__alertcure__create_pull_request":
      return (
        <>
          {approval.preview && (
            <Field label="push する内容">
              <pre className={PRE}>{approval.preview}</pre>
            </Field>
          )}
          <Field label="タイトル">
            <p className="text-sm font-medium">{String(input.title ?? "")}</p>
          </Field>
          <Field label="本文（末尾に対象の Alert へのリンクが付きます）">
            <pre className={`${PRE} font-sans`}>{String(input.body ?? "")}</pre>
          </Field>
        </>
      );
    case "mcp__alertcure__dismiss_alert":
      return (
        <>
          <Field label="理由">
            <p className="font-mono text-sm">{String(input.reason ?? "")}</p>
          </Field>
          <Field label="コメント（GitHub に記録されます）">
            <pre className={`${PRE} font-sans`}>{String(input.comment ?? "")}</pre>
          </Field>
        </>
      );
    default:
      return (
        <Field label="入力">
          <pre className={PRE}>{JSON.stringify(approval.input, null, 2)}</pre>
        </Field>
      );
  }
}

/** エージェントが承認の必要な操作をしようとしたときに表示する */
export function ApprovalDialog({
  approval,
  remaining,
  onRespond,
}: {
  approval: Approval;
  /** この後に控えている承認依頼の件数 */
  remaining: number;
  onRespond: (approved: boolean, message?: string) => void;
}) {
  const [message, setMessage] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">承認が必要です{remaining > 0 && `（ほかに ${remaining} 件）`}</p>
          <h2 id="approval-title" className="mt-0.5 font-semibold break-all">
            {approval.title}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">理由: {approval.reason}</p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <Details approval={approval} />
          <Field label="拒否する場合の理由（任意。エージェントに伝わります）">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <Button onClick={() => onRespond(false, message)}>拒否</Button>
          <Button variant="primary" onClick={() => onRespond(true)}>
            承認して実行
          </Button>
        </div>
      </div>
    </div>
  );
}
