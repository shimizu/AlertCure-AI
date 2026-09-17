import { describe, expect, it } from "vitest";
import { parseRoute, repoHref } from "./router";

describe("parseRoute", () => {
  it("parses repository routes and round-trips repoHref", () => {
    expect(parseRoute(repoHref("octo", "kepler.gl"))).toEqual({ name: "repo", owner: "octo", repo: "kepler.gl" });
  });

  it("falls back to the dashboard", () => {
    expect(parseRoute("")).toEqual({ name: "dashboard" });
    expect(parseRoute("#/repos/octo")).toEqual({ name: "dashboard" });
  });
});
