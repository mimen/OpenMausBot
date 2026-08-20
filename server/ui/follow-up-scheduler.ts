export type FollowUpSchedulerClock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

export type FollowUpWakeScheduler = {
  schedule: (at: number) => void;
  stop: () => void;
};

const SYSTEM_CLOCK: FollowUpSchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export function futureFollowUpClaimExpiry(claimedUntil: string | undefined, now: number): number | null {
  if (!claimedUntil) return null;
  const at = Date.parse(claimedUntil);
  return Number.isFinite(at) && at > now ? at : null;
}

export function createFollowUpWakeScheduler(
  wake: () => void,
  clock: FollowUpSchedulerClock = SYSTEM_CLOCK,
): FollowUpWakeScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduledAt = Number.POSITIVE_INFINITY;

  return {
    schedule(at: number): void {
      const target = Math.max(clock.now(), at);
      if (timer && scheduledAt <= target) return;
      if (timer) clock.clearTimeout(timer);
      scheduledAt = target;
      timer = clock.setTimeout(() => {
        timer = null;
        scheduledAt = Number.POSITIVE_INFINITY;
        wake();
      }, Math.max(0, target - clock.now()));
    },
    stop(): void {
      if (timer) clock.clearTimeout(timer);
      timer = null;
      scheduledAt = Number.POSITIVE_INFINITY;
    },
  };
}
