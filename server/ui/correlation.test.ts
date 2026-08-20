import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { UiCallCorrelation } from "./correlation.ts";

const event: RuntimeEvent = {
  eventId: "event",
  provider: "claudeAgent",
  providerInstanceId: "claude",
  threadId: "thread",
  createdAt: "2026-08-20T12:00:00.000Z",
  turnId: "turn",
  itemId: "toolu-1",
  type: "item.started",
  itemType: "tool",
  title: "mcp__ui__show_quote",
  arguments: { quote: "Words", attribution: "Person" },
};

const request = {
  threadId: "thread",
  name: "show_quote",
  arguments: { quote: "Words", attribution: "Person" },
  provider: "claudeAgent",
  providerInstanceId: "claude",
  providerCallId: "rpc-1",
};

describe("UiCallCorrelation", () => {
  it("correlates when the provider event arrives before the proxy call", async () => {
    const correlation = new UiCallCorrelation();
    correlation.record(event);
    await expect(correlation.claim(request)).resolves.toEqual({
      provider: "claudeAgent",
      providerInstanceId: "claude",
      turnId: "turn",
      itemId: "toolu-1",
      providerCallId: "rpc-1",
    });
  });

  it("correlates when the proxy call arrives before the provider event", async () => {
    const correlation = new UiCallCorrelation();
    const claimed = correlation.claim(request);
    correlation.record(event);
    await expect(claimed).resolves.toEqual({
      provider: "claudeAgent",
      providerInstanceId: "claude",
      turnId: "turn",
      itemId: "toolu-1",
      providerCallId: "rpc-1",
    });
  });
});
