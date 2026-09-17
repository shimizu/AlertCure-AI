import { describe, expect, it } from "vitest";
import { countBySeverity, countPackages, filterAlerts, sortAlerts } from "./alertTable";
import type { DependabotAlert, Severity } from "./types";

function alert(number: number, severity: Severity, name: string, cvssScore: number | null = null): DependabotAlert {
  return {
    number,
    state: "open",
    url: "",
    createdAt: "2026-09-01T00:00:00Z",
    severity,
    package: { ecosystem: "npm", name },
    manifestPath: "package-lock.json",
    scope: "runtime",
    relationship: "direct",
    ghsaId: `GHSA-${number}`,
    cveId: number === 1 ? "CVE-2026-0001" : null,
    summary: `${name} issue`,
    vulnerableVersionRange: null,
    firstPatchedVersion: null,
    cvssScore,
  };
}

const alerts = [
  alert(1, "low", "lodash"),
  alert(2, "critical", "axios", 9.1),
  alert(3, "critical", "vite", 9.8),
  alert(4, "high", "lodash"),
];

describe("alertTable", () => {
  it("sorts by severity, then CVSS, then number", () => {
    expect(sortAlerts(alerts).map((a) => a.number)).toEqual([3, 2, 4, 1]);
  });

  it("filters by severity and free text (package, CVE)", () => {
    expect(filterAlerts(alerts, { query: "", severities: ["critical"] }).map((a) => a.number)).toEqual([2, 3]);
    expect(filterAlerts(alerts, { query: "LODASH", severities: [] }).map((a) => a.number)).toEqual([1, 4]);
    expect(filterAlerts(alerts, { query: "cve-2026-0001", severities: [] }).map((a) => a.number)).toEqual([1]);
  });

  it("counts severities and distinct packages", () => {
    expect(countBySeverity(alerts)).toEqual({ critical: 2, high: 1, medium: 0, low: 1 });
    expect(countPackages(alerts)).toBe(3);
  });
});
