import { describe, expect, it } from "vitest";
import { parseRoute, repoHref, sessionHref } from "./router";

describe("parseRoute", () => {
  it("parses repository routes and round-trips repoHref", () => {
    expect(parseRoute(repoHref("octo", "kepler.gl"))).toEqual({ name: "repo", owner: "octo", repo: "kepler.gl" });
  });

  it("parses session routes", () => {
    expect(parseRoute(sessionHref("octo", "app", "abc-1"))).toEqual({ name: "session", owner: "octo", repo: "app", id: "abc-1" });
  });

  it("falls back to the dashboard", () => {
    expect(parseRoute("")).toEqual({ name: "dashboard" });
    expect(parseRoute("#/repos/octo")).toEqual({ name: "dashboard" });
  });
});
