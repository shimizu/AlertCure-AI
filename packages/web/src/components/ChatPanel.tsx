import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describeTool, pendingApprovals, type ChatItem, type ChatState } from "../lib/chat";
import { Button, Spinner } from "./ui";

const STATUS_LABEL = {
  preparing: "準備中",
  running: "応答中",
  idle: "入力待ち",
  error: "エラー",
  closed: "終了",
} as const;

// @tailwindcss/typography を入れずに、Markdown の要素へ最低限の体裁をつける
const MARKDOWN_CLASS = [
  "space-y-2 leading-relaxed break-words",
  "[&_h1]:text-base [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_a]:text-indigo-700 [&_a]:underline dark:[&_a]:text-indigo-300",
  "[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:text-[0.85em] dark:[&_code]:bg-slate-800",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-slate-100 [&_pre]:p-3 dark:[&_pre]:bg-slate-800 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:block [&_table]:overflow-x-auto [&_table]:text-xs [&_th]:border [&_th]:border-slate-300 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 dark:[&_th]:border-slate-700 dark:[&_td]:border-slate-700",
].join(" ");

export function ChatPanel({
  state,
  connected,
  workspace,
  onSend,
  onInterrupt,
}: {
  state: ChatState;
  connected: boolean;
  workspace: string | null;
  onSend: (text: string) => boolean;
  onInterrupt: () => void;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const { status } = state;
  const canSend = connected && status === "idle" && draft.trim().length > 0;
  const waitingApproval = pendingApprovals(state).length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [state.items]);

  const submit = () => {
    if (canSend && onSend(draft.trim())) setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 日本語入力の変換確定の Enter では送信しない
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {state.items.map((item, i) => (
          <ChatItemView key={i} item={item} workspace={workspace} />
        ))}
        {(status === "preparing" || status === "running") && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner />{" "}
            {state.statusDetail ??
              (status === "preparing" ? "準備しています…" : waitingApproval ? "承認を待っています…" : "考えています…")}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder={status === "idle" ? "返信を入力（Enter で送信、Shift+Enter で改行）" : "応答が終わると入力できます"}
          disabled={!connected || status === "error" || status === "closed"}
          className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`} />
            {connected ? (status ? STATUS_LABEL[status] : "接続済み") : "再接続しています…"}
          </span>
          {state.costUsd > 0 && <span className="tabular-nums">累計 ${state.costUsd.toFixed(3)}</span>}
          <span className="ml-auto flex gap-2">
            {status === "running" && <Button onClick={onInterrupt}>■ 中断</Button>}
            <Button variant="primary" onClick={submit} disabled={!canSend}>
              送信
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

function ChatItemView({ item, workspace }: { item: ChatItem; workspace: string | null }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-indigo-600 px-3 py-2 text-sm whitespace-pre-wrap text-white">
          {item.text}
        </div>
      );
    case "assistant":
      return (
        <div className={`text-sm ${MARKDOWN_CLASS}`}>
          <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
        </div>
      );
    case "tool": {
      const { label, detail } = describeTool(item.name, item.input, workspace ?? undefined);
      return (
        <details className="group rounded-md border border-slate-200 bg-slate-50 text-xs dark:border-slate-800 dark:bg-slate-900/60">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-slate-600 dark:text-slate-300">
            {item.result === null ? (
              <Spinner />
            ) : (
              <span className={item.result.isError ? "text-red-600" : "text-emerald-600"}>{item.result.isError ? "✕" : "✓"}</span>
            )}
            <span className="font-medium">{label}</span>
            <span className="truncate font-mono text-slate-500">{detail}</span>
          </summary>
          {item.result && (
            <pre className="max-h-64 overflow-auto border-t border-slate-200 px-3 py-2 whitespace-pre-wrap text-slate-600 dark:border-slate-800 dark:text-slate-400">
              {item.result.content || "（出力なし）"}
            </pre>
          )}
        </details>
      );
    }
    case "approval": {
      const state =
        item.approved === null
          ? { label: "承認待ち", style: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" }
          : item.approved
            ? { label: "承認済み", style: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" }
            : { label: "拒否", style: "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" };
      return (
        <div className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${state.style}`}>
          <span className="font-semibold whitespace-nowrap">{state.label}</span>
          <span className="truncate">{item.title}</span>
        </div>
      );
    }
    case "result":
      return (
        <p className="text-center text-[11px] text-slate-400">
          {item.isError ? "エラーで終了" : "応答完了"} ・ {(item.durationMs / 1000).toFixed(1)} 秒 ・ {item.numTurns} ターン
        </p>
      );
    case "error":
      return (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm whitespace-pre-wrap text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {item.message}
        </div>
      );
  }
}
