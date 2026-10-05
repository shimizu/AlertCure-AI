import { describe, expect, it } from "vitest";
import { isAllowedOrigin, parseClientMessage } from "./ws.js";

describe("isAllowedOrigin", () => {
  it("accepts local origins and non-browser clients", () => {
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("http://localhost:8787")).toBe(true);
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it("rejects other sites", () => {
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1.evil.example")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
  });
});

describe("parseClientMessage", () => {
  it("accepts known messages and drops malformed ones", () => {
    expect(parseClientMessage('{"type":"approval_response","id":"a","approved":false,"message":"だめ"}')).toEqual({
      type: "approval_response",
      id: "a",
      approved: false,
      message: "だめ",
    });
    expect(parseClientMessage('{"type":"approval_response","id":"a","approved":"yes"}')).toBeNull();
    expect(parseClientMessage('{"type":"user_message","text":"  "}')).toBeNull();
    expect(parseClientMessage("not json")).toBeNull();
  });
});
