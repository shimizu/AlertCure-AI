import type { AlertState, DependabotAlert, RefreshStatus, RepoSummary } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new ApiError(body.error ?? `リクエストに失敗しました (${res.status})`, res.status, body.code);
  }
  return body as T;
}

export interface ReposResponse {
  repos: RepoSummary[] | null;
  fetchedAt: string | null;
  refresh: RefreshStatus;
}

export interface AlertsResponse {
  alerts: DependabotAlert[];
  fetchedAt: string;
}

export const api = {
  getRepos: () => request<ReposResponse>("/api/repos"),
  refreshRepos: () => request<{ refresh: RefreshStatus }>("/api/repos/refresh", { method: "POST" }),
  getAlerts: (owner: string, repo: string, state: AlertState, refresh = false) => {
    const params = new URLSearchParams({ state });
    if (refresh) params.set("refresh", "1");
    return request<AlertsResponse>(
      `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/alerts?${params}`,
    );
  },
};
