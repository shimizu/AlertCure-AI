import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  const styles =
    variant === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-300 dark:disabled:bg-indigo-900"
      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function Notice({ tone, children }: { tone: "info" | "error" | "warning"; children: ReactNode }) {
  const styles = {
    info: "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-100",
    error: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
    warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-slate-300 px-1.5 text-[11px] leading-4 text-slate-500 dark:border-slate-600 dark:text-slate-400">
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
  );
}

export function SortHeader({
  label,
  active,
  desc,
  onClick,
  align = "right",
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white ${active ? "text-slate-900 dark:text-white" : ""}`}
      >
        {label}
        <span className="w-2 text-[10px]">{active ? (desc ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}
