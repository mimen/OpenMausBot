import { describe, expect, it } from "vitest";

import { GALLERY, isUiToolTitle, uiToolNameFromTitle } from "./gallery.ts";

describe("gallery", () => {
  it("classifies only exact gallery names or the exact ui MCP namespace", () => {
    expect(GALLERY.map((spec) => spec.name)).toContain("show_todoist_tasks");
    expect(isUiToolTitle("show_todoist_tasks")).toBe(true);
    expect(isUiToolTitle("mcp__ui__show_todoist_tasks")).toBe(true);
    expect(uiToolNameFromTitle("mcp__ui__show_todoist_tasks")).toBe("show_todoist_tasks");

    expect(isUiToolTitle("mcp__github__show_quote")).toBe(false);
    expect(isUiToolTitle("github__show_quote")).toBe(false);
    expect(isUiToolTitle("prefix mcp__ui__show_quote suffix")).toBe(false);
    expect(isUiToolTitle("mcp__ui__show_quote_extra")).toBe(false);
    expect(isUiToolTitle("Bash")).toBe(false);
  });
});
