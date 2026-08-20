import { describe, expect, it } from "vitest";

import { GALLERY_BY_NAME } from "./gallery.ts";
import { validateArgs } from "./validate.ts";

describe("validateArgs", () => {
  it("accepts a record card and rejects extra keys", () => {
    const schema = GALLERY_BY_NAME.get("show_record_card")!.parameters;
    const ok = validateArgs(schema, {
      title: "Order 12",
      fields: [{ label: "Total", value: "$40" }],
    });
    expect(ok.ok).toBe(true);
    const extra = validateArgs(schema, {
      title: "Order 12",
      fields: [{ label: "Total", value: "$40" }],
      surprise: true,
    });
    expect(extra.ok).toBe(false);
  });

  it("requires exact Todoist task ids as strings", () => {
    const schema = GALLERY_BY_NAME.get("show_todoist_tasks")!.parameters;
    expect(validateArgs(schema, { taskIds: ["6hJCfm66Hh5Q4wqv"] }).ok).toBe(true);
    expect(validateArgs(schema, { taskIds: [] }).ok).toBe(false);
    expect(validateArgs(schema, { taskIds: Array.from({ length: 26 }, (_, index) => `task-${index}`) }).ok).toBe(false);
    expect(validateArgs(schema, { taskIds: [1] }).ok).toBe(false);
    expect(validateArgs(schema, {}).ok).toBe(false);
  });
});
