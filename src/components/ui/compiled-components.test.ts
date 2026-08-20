import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { COMPONENT_GALLERY_MESSAGES } from "@/component-gallery";
import { GALLERY } from "../../../server/ui/gallery.ts";
import { ComponentRenderer, RENDERER_NAMES } from "./renderer";
import { reconcileSupplementOverlays } from "./supplement-stack";

const compiledNames = [
  "show_status_board",
  "show_supplement_stack",
  "show_week_calendar",
  "show_supply_status",
  "show_conversation",
  "show_booking_slot",
  "show_event_countdown",
];

function renderMessage(message: (typeof COMPONENT_GALLERY_MESSAGES)[number]): string {
  return renderToStaticMarkup(createElement(ComponentRenderer, { message, threadId: "gallery-thread" }));
}

describe("compiled component renderers", () => {
  it("has one renderer registry entry for every private gallery tool", () => {
    expect([...RENDERER_NAMES].sort()).toEqual(GALLERY.map((spec) => spec.name).sort());
  });

  it.each(compiledNames)("renders %s from its bounded gallery fixture", (name) => {
    const message = COMPONENT_GALLERY_MESSAGES.find((candidate) => candidate.component?.name === name);
    if (!message) throw new Error(`missing gallery fixture for ${name}`);
    const html = renderMessage(message);
    expect(html).toContain("<figure");
    expect(html).not.toContain("could not be read safely");
    expect(html).not.toContain("failed to draw");
  });

  it("lets a second-window server patch replace stale local supplement state", () => {
    const current = {
      magnesium: { checked: true, pending: false, baseChecked: false },
    };
    expect(reconcileSupplementOverlays(current, new Map([["magnesium", true]]))).toEqual({});
    expect(reconcileSupplementOverlays({
      magnesium: { checked: true, pending: true, baseChecked: false },
    }, new Map([["magnesium", false]]))).toHaveProperty("magnesium.pending", true);
  });

  it("renders screen-reader state, timer semantics, and trusted action boundaries", () => {
    const html = COMPONENT_GALLERY_MESSAGES.map(renderMessage).join("\n");
    expect(html).toContain('role="timer"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("never edit the regimen source");
    expect(html).toContain("Nothing sends from this card");
    expect(html).toContain("Square availability is unverified");
  });
});
