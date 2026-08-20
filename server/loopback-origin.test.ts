import { describe, expect, it } from "vitest";

import { isAllowedOrigin, isLoopbackHost, trustedBrowserMutation } from "./loopback-origin.ts";

describe("loopback browser mutation boundary", () => {
  it("accepts loopback hosts and rejects rebinding or remote hosts", () => {
    expect(isLoopbackHost("127.0.0.1:8799")).toBe(true);
    expect(isLoopbackHost("[::1]:8799")).toBe(true);
    expect(isLoopbackHost("openmaus.attacker.test:8799")).toBe(false);
    expect(isAllowedOrigin("https://example.com")).toBe(false);
  });

  it("requires an explicit loopback Origin and non-simple JSON content", () => {
    expect(trustedBrowserMutation({ origin: undefined, contentType: "application/json" })).toMatchObject({ ok: false, status: 403 });
    expect(trustedBrowserMutation({ origin: "https://example.com", contentType: "application/json" })).toMatchObject({ ok: false, status: 403 });
    expect(trustedBrowserMutation({ origin: "http://127.0.0.1:5199", contentType: "application/x-www-form-urlencoded" })).toMatchObject({ ok: false, status: 415 });
    expect(trustedBrowserMutation({ origin: "http://127.0.0.1:5199", contentType: "application/json; charset=utf-8" })).toEqual({ ok: true });
  });
});
