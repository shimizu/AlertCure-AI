import { numberFormat } from "../lib/format";
import { SEVERITY_ORDER, type Severity, type SeverityCounts } from "../lib/types";

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** 重大度ごとの色（バッジ・バー・件数表示で共通） */
export const SEVERITY_STYLE: Record<Severity, { badge: string; bar: string; text: string }> = {
  critical: {
    badge: "bg-red-600 text-white",
    bar: "bg-red-600",
    text: "text-red-700 dark:text-red-400",
  },
  high: {
    badge: "bg-orange-500 text-white",
    bar: "bg-orange-500",
    text: "text-orange-700 dark:text-orange-400",
  },
  medium: {
    badge: "bg-amber-300 text-amber-950",
    bar: "bg-amber-300",
    text: "text-amber-700 dark:text-amber-300",
  },
  low: {
    badge: "bg-slate-300 text-slate-800 dark:bg-slate-600 dark:text-slate-100",
    bar: "bg-slate-300 dark:bg-slate-600",
    text: "text-slate-600 dark:text-slate-400",
  },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-block min-w-16 rounded px-1.5 py-0.5 text-center text-xs font-semibold ${SEVERITY_STYLE[severity].badge}`}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/** 件数を表示する。0 は薄く表示して、目立たせたい数字だけが浮くようにする */
export function SeverityCount({ severity, count }: { severity: Severity; count: number }) {
  if (count === 0) return <span className="text-slate-300 dark:text-slate-600">0</span>;
  return <span className={`font-semibold ${SEVERITY_STYLE[severity].text}`}>{numberFormat.format(count)}</span>;
}

/** 重大度の内訳を 1 本の積み上げバーで表す */
export function SeverityBar({ counts, total }: { counts: SeverityCounts; total: number }) {
  if (total === 0) return <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800" />;
  return (
    <div
      className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      title={SEVERITY_ORDER.map((s) => `${SEVERITY_LABEL[s]}: ${counts[s]}`).join(" / ")}
    >
      {SEVERITY_ORDER.map((s) =>
        counts[s] > 0 ? (
          <div key={s} className={SEVERITY_STYLE[s].bar} style={{ width: `${(counts[s] / total) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}
