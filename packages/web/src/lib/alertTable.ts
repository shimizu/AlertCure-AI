import { SEVERITY_ORDER, type DependabotAlert, type Severity } from "./types";

export interface AlertFilters {
  query: string;
  severities: Severity[];
}

export function filterAlerts(alerts: DependabotAlert[], filters: AlertFilters): DependabotAlert[] {
  const query = filters.query.trim().toLowerCase();
  return alerts.filter((alert) => {
    if (filters.severities.length > 0 && !filters.severities.includes(alert.severity)) return false;
    if (!query) return true;
    return [alert.package.name, alert.manifestPath, alert.ghsaId, alert.cveId ?? "", alert.summary].some((v) =>
      v.toLowerCase().includes(query),
    );
  });
}

/** 重大度の高い順、同じなら CVSS の高い順、さらに番号の新しい順 */
export function sortAlerts(alerts: DependabotAlert[]): DependabotAlert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      (b.cvssScore ?? 0) - (a.cvssScore ?? 0) ||
      b.number - a.number,
  );
}

export function countBySeverity(alerts: DependabotAlert[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const alert of alerts) counts[alert.severity] += 1;
  return counts;
}

export function countPackages(alerts: DependabotAlert[]): number {
  return new Set(alerts.map((a) => `${a.package.ecosystem}:${a.package.name}`)).size;
}
