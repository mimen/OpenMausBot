import { describe, expect, it } from "vitest";

import type { Routine, RoutineRun } from "@/lib/routines";

import { cardLanes, projectedItems } from "./RoutinesPage";

const at = (hour: number, minute = 0) => new Date(2026, 10, 2, hour, minute).getTime();
const item = (id: string, when: number) => ({ id, at: when, routine: null, run: null });

describe("cardLanes", () => {
  it("puts schedules at the same time side by side", () => {
    const lanes = cardLanes([item("a", at(9)), item("b", at(9))]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
  });

  it("keeps cards that do not overlap at full width", () => {
    const lanes = cardLanes([item("a", at(9)), item("b", at(9, 30)), item("c", at(11))]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("projectedItems", () => {
  const day = (date: number, hour = 0) => new Date(2026, 10, date, hour).getTime();
  // Daily 09:00, created the week before. The computer was off from Wednesday
  // 10:00 to Saturday 10:00: the server recorded Thursday as missed and moved
  // on to Sunday, so Friday and Saturday never get a receipt.
  const routine: Routine = {
    id: "r",
    name: "Standup notes",
    prompt: "Write them",
    botId: "b",
    runOn: "maus",
    enabled: true,
    schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
    durationMinutes: 30,
    nextRunAt: day(8, 9),
    createdAt: day(1),
    updatedAt: day(7, 10),
  };
  const missed: RoutineRun = {
    id: "m",
    routineId: "r",
    routineName: "Standup notes",
    botId: "b",
    runOn: "maus",
    scheduledFor: day(5, 9),
    status: "missed",
    manual: false,
    createdAt: day(7, 10),
  };

  it("does not draw occurrences before the next run that will never happen", () => {
    const items = projectedItems([routine], [missed], day(5), day(9));
    expect(items.map((item) => [new Date(item.at).getDate(), item.run?.status ?? "upcoming"])).toEqual([
      [5, "missed"],
      [8, "upcoming"],
    ]);
  });
});
