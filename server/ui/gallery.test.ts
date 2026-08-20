import { describe, expect, it } from "vitest";

import { GALLERY, isUiToolTitle } from "./gallery.ts";

describe("gallery", () => {
  it("exposes a stable Todoist tool the model can call", () => {
    expect(GALLERY.map((spec) => spec.name)).toContain("show_todoist_tasks");
    expect(isUiToolTitle("show_todoist_tasks")).toBe(true);
    expect(isUiToolTitle("mcp__ui__show_todoist_tasks")).toBe(true);
    expect(isUiToolTitle("Bash")).toBe(false);
  });
});
