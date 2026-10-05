import { useSyncExternalStore } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "repo"; owner: string; repo: string }
  | { name: "session"; owner: string; repo: string; id: string };

/** `#/repos/owner/name`（`/sessions/<id>` が続くとセッション画面）形式のハッシュを画面に対応づける */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "repos" && parts[1] && parts[2] && parts[3] === "sessions" && parts[4]) {
    return { name: "session", owner: parts[1], repo: parts[2], id: parts[4] };
  }
  if (parts[0] === "repos" && parts[1] && parts[2]) {
    return { name: "repo", owner: parts[1], repo: parts[2] };
  }
  return { name: "dashboard" };
}

export function repoHref(owner: string, repo: string): string {
  return `#/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function sessionHref(owner: string, repo: string, id: string): string {
  return `${repoHref(owner, repo)}/sessions/${encodeURIComponent(id)}`;
}

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}
