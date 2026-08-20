import { describe, expect, it } from "vitest";

import { UiAccessRegistry } from "./access.ts";

describe("private per-turn UI access", () => {
  it("binds a token to the exact bot, thread, provider, and provider instance", () => {
    const registry = new UiAccessRegistry();
    const scope = { botId: "bot-1", threadId: "thread-1", provider: "claudeAgent", providerInstanceId: "claude-one" };
    const token = registry.issue(scope, 1_000, 10_000);
    expect(registry.authorize(`Bearer ${token}`, scope, 2_000)).toBe(true);
    expect(registry.authorize(`Bearer ${token}`, { ...scope, threadId: "thread-2" }, 2_000)).toBe(false);
    expect(registry.authorize(`Bearer ${token}`, { ...scope, providerInstanceId: "claude-two" }, 2_000)).toBe(false);
  });

  it("expires and settles grants without exposing the broader comms token", () => {
    const registry = new UiAccessRegistry();
    const scope = { botId: "bot-1", threadId: "thread-1", provider: "codex", providerInstanceId: "codex-one" };
    const expired = registry.issue(scope, 1_000, 1);
    expect(registry.authorize(`Bearer ${expired}`, scope, 1_002)).toBe(false);
    const live = registry.issue(scope, 2_000, 10_000);
    registry.settleThread(scope.threadId);
    expect(registry.authorize(`Bearer ${live}`, scope, 2_001)).toBe(false);
  });
});
