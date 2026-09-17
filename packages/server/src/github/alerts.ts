import type { Octokit } from "@octokit/rest";
import type { AlertState, DependabotAlert } from "../types.js";
import { normalizeSeverity } from "./severity.js";

export class AlertsDisabledError extends Error {
  constructor(fullName: string) {
    super(`${fullName} では Dependabot Alert が無効になっています。`);
    this.name = "AlertsDisabledError";
  }
}

type RawAlert = Awaited<
  ReturnType<Octokit["rest"]["dependabot"]["listAlertsForRepo"]>
>["data"][number];

function toAlert(raw: RawAlert): DependabotAlert {
  const advisory = raw.security_advisory;
  const vulnerability = raw.security_vulnerability;
  return {
    number: raw.number,
    state: raw.state as AlertState,
    url: raw.html_url,
    createdAt: raw.created_at,
    severity: normalizeSeverity(vulnerability.severity),
    package: {
      ecosystem: raw.dependency.package?.ecosystem ?? vulnerability.package.ecosystem,
      name: raw.dependency.package?.name ?? vulnerability.package.name,
    },
    manifestPath: raw.dependency.manifest_path ?? "",
    scope: raw.dependency.scope ?? null,
    relationship: (raw.dependency as { relationship?: string | null }).relationship ?? null,
    ghsaId: advisory.ghsa_id,
    cveId: advisory.cve_id,
    summary: advisory.summary,
    vulnerableVersionRange: vulnerability.vulnerable_version_range ?? null,
    firstPatchedVersion: vulnerability.first_patched_version?.identifier ?? null,
    cvssScore: advisory.cvss?.score ?? null,
  };
}

function isStatus(error: unknown, status: number): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === status;
}

export async function listDependabotAlerts(
  octokit: Octokit,
  owner: string,
  repo: string,
  state: AlertState = "open",
): Promise<DependabotAlert[]> {
  try {
    const raws = await octokit.paginate(octokit.rest.dependabot.listAlertsForRepo, {
      owner,
      repo,
      state,
      per_page: 100,
    });
    return raws.map(toAlert);
  } catch (error) {
    // Dependabot Alert が無効なリポジトリでは 403 が返る
    if (isStatus(error, 403)) throw new AlertsDisabledError(`${owner}/${repo}`);
    throw error;
  }
}

export type DismissReason = "fix_started" | "inaccurate" | "no_bandwidth" | "not_used" | "tolerable_risk";

export async function dismissDependabotAlert(
  octokit: Octokit,
  params: { owner: string; repo: string; alertNumber: number; reason: DismissReason; comment?: string },
): Promise<DependabotAlert> {
  const { data } = await octokit.rest.dependabot.updateAlert({
    owner: params.owner,
    repo: params.repo,
    alert_number: params.alertNumber,
    state: "dismissed",
    dismissed_reason: params.reason,
    dismissed_comment: params.comment,
  });
  return toAlert(data);
}

export async function createPullRequest(
  octokit: Octokit,
  params: { owner: string; repo: string; head: string; base: string; title: string; body: string },
): Promise<{ number: number; url: string }> {
  const { data } = await octokit.rest.pulls.create(params);
  return { number: data.number, url: data.html_url };
}
