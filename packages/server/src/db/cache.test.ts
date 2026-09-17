import { describe, expect, it, vi } from "vitest";
import { cached, Cache } from "./cache.js";

describe("Cache", () => {
  it("stores and overwrites JSON values", () => {
    const cache = new Cache(":memory:");
    expect(cache.get("k")).toBeUndefined();
    cache.set("k", { a: 1 }, new Date("2026-09-01T00:00:00Z"));
    cache.set("k", { a: 2 }, new Date("2026-09-02T00:00:00Z"));
    expect(cache.get("k")).toEqual({ value: { a: 2 }, fetchedAt: "2026-09-02T00:00:00.000Z" });
    cache.delete("k");
    expect(cache.get("k")).toBeUndefined();
    cache.close();
  });

  it("cached() loads only on miss or refresh", async () => {
    const cache = new Cache(":memory:");
    const load = vi.fn(async () => load.mock.calls.length);
    expect((await cached(cache, "k", false, load)).value).toBe(1);
    expect((await cached(cache, "k", false, load)).value).toBe(1);
    expect((await cached(cache, "k", true, load)).value).toBe(2);
    cache.close();
  });
});
