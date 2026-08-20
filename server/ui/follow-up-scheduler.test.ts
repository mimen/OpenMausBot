import { afterEach, describe, expect, it, vi } from "vitest";

import { createFollowUpWakeScheduler, futureFollowUpClaimExpiry } from "./follow-up-scheduler.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("follow-up lease wake scheduler", () => {
  it("does not turn an already-expired lease into a zero-delay wake loop", () => {
    const now = Date.parse("2026-08-20T12:00:30.000Z");
    expect(futureFollowUpClaimExpiry("2026-08-20T12:00:29.999Z", now)).toBeNull();
    expect(futureFollowUpClaimExpiry("2026-08-20T12:00:31.000Z", now)).toBe(Date.parse("2026-08-20T12:00:31.000Z"));
  });

  it("wakes at a restored live claim expiry without unrelated activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    const wake = vi.fn();
    const scheduler = createFollowUpWakeScheduler(wake);

    scheduler.schedule(Date.parse("2026-08-20T12:00:30.000Z"));
    vi.advanceTimersByTime(29_999);
    expect(wake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(wake).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it("moves an existing wake earlier when a newer lease expires first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    const wake = vi.fn();
    const scheduler = createFollowUpWakeScheduler(wake);

    scheduler.schedule(Date.parse("2026-08-20T12:00:30.000Z"));
    scheduler.schedule(Date.parse("2026-08-20T12:00:10.000Z"));
    vi.advanceTimersByTime(10_000);

    expect(wake).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });
});
