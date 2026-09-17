import { Octokit } from "@octokit/rest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AlertsDisabledError, listDependabotAlerts } from "./alerts.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const octokit = new Octokit({ auth: "test-token" });
const ALERTS_URL = "https://api.github.com/repos/octo/app/dependabot/alerts";

function rawAlert(number: number, severity: string) {
  return {
    number,
    state: "open",
    html_url: `https://github.com/octo/app/security/dependabot/${number}`,
    created_at: "2026-09-01T00:00:00Z",
    dependency: {
      package: { ecosystem: "npm", name: "lodash" },
      manifest_path: "package-lock.json",
      scope: "runtime",
      relationship: "transitive",
    },
    security_advisory: {
      ghsa_id: `GHSA-${number}`,
      cve_id: null,
      summary: "Prototype pollution",
      cvss: { score: 7.5, vector_string: null },
    },
    security_vulnerability: {
      package: { ecosystem: "npm", name: "lodash" },
      severity,
      vulnerable_version_range: "< 4.17.21",
      first_patched_version: { identifier: "4.17.21" },
    },
  };
}

describe("listDependabotAlerts", () => {
  it("follows Link pagination and normalizes fields", async () => {
    server.use(
      http.get(ALERTS_URL, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("state")).toBe("open");
        if (url.searchParams.get("page") === "2") {
          return HttpResponse.json([rawAlert(2, "medium")]);
        }
        return HttpResponse.json([rawAlert(1, "critical")], {
          headers: { Link: `<${ALERTS_URL}?state=open&per_page=100&page=2>; rel="next"` },
        });
      }),
    );

    const alerts = await listDependabotAlerts(octokit, "octo", "app");

    expect(alerts.map((a) => [a.number, a.severity])).toEqual([
      [1, "critical"],
      [2, "medium"],
    ]);
    expect(alerts[0]).toMatchObject({
      package: { ecosystem: "npm", name: "lodash" },
      manifestPath: "package-lock.json",
      relationship: "transitive",
      firstPatchedVersion: "4.17.21",
      cvssScore: 7.5,
    });
  });

  it("throws AlertsDisabledError on 403", async () => {
    server.use(
      http.get(ALERTS_URL, () =>
        HttpResponse.json({ message: "Dependabot alerts are disabled for this repository." }, { status: 403 }),
      ),
    );
    await expect(listDependabotAlerts(octokit, "octo", "app")).rejects.toBeInstanceOf(AlertsDisabledError);
  });
});
