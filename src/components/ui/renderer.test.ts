import { describe, expect, it } from "vitest";

import { UI_LIMITS } from "../../../server/ui/contract";
import { boundedChecklistItems, boundedMetrics, boundedRecordFields } from "./renderer";
import { boundedTodoistTasks, todoistActionLabel } from "./todoist-tasks";

describe("component renderer bounds", () => {
  it("announces the Todoist loading state in the button name", () => {
    expect(todoistActionLabel("loading", "Task A")).toBe("Completing Task A");
    expect(todoistActionLabel("completed", "Task A")).toBe("Completed Task A");
  });

  it("caps every row-producing renderer helper", () => {
    expect(boundedRecordFields(Array.from({ length: 500 }, (_, index) => ({ label: `L${index}`, value: "v" })))).toHaveLength(UI_LIMITS.recordRows);
    expect(boundedMetrics(Array.from({ length: 500 }, (_, index) => ({ label: `L${index}`, value: "v" })))).toHaveLength(UI_LIMITS.metricsRows);
    expect(boundedChecklistItems(Array.from({ length: 500 }, (_, index) => ({ text: `I${index}`, done: false })))).toHaveLength(UI_LIMITS.checklistRows);
  });

  it("fails a Todoist card closed when a stored row collection is oversized", () => {
    const call = {
      callId: "call",
      name: "show_todoist_tasks",
      result: "shown",
      status: "shown",
      origin: { provider: "test" },
      arguments: {
        tasks: Array.from({ length: UI_LIMITS.todoistRows + 1 }, (_, index) => ({
          id: `task-${index}`,
          content: "Task",
          isCompleted: false,
          url: null,
          due: null,
        })),
      },
    } as const;
    expect(boundedTodoistTasks(call)).toEqual([]);
  });

  it("drops oversized individual strings rather than mounting them", () => {
    expect(boundedChecklistItems([{ text: "x".repeat(UI_LIMITS.content + 1), done: false }])).toEqual([]);
    expect(boundedRecordFields([{ label: "x".repeat(UI_LIMITS.label + 1), value: "v" }])).toEqual([]);
  });
});
