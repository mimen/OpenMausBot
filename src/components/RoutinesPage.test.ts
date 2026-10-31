import { describe, expect, it } from "vitest";

import { cardLanes } from "./RoutinesPage";

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
