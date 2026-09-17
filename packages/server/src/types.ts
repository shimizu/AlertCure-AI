export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type SeverityCounts = Record<Severity, number>;

export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  pushedAt: string | null;
  defaultBranch: string | null;
  language: string | null;
  /** false のときは Dependabot Alert が無効（件数は常に 0） */
  alertsEnabled: boolean;
  openAlerts: SeverityCounts & { total: number };
}

export type AlertState = "open" | "dismissed" | "fixed" | "auto_dismissed";

export interface DependabotAlert {
  number: number;
  state: AlertState;
  url: string;
  createdAt: string;
  severity: Severity;
  package: { ecosystem: string; name: string };
  manifestPath: string;
  scope: string | null;
  relationship: string | null;
  ghsaId: string;
  cveId: string | null;
  summary: string;
  vulnerableVersionRange: string | null;
  firstPatchedVersion: string | null;
  cvssScore: number | null;
}

export function emptySeverityCounts(): SeverityCounts & { total: number } {
  return { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
}
