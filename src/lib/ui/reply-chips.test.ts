import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReplyChips } from "@/components/ui/grammar";
import { mergeReplyChipPrefill } from "./reply-chips";

describe("ReplyChips", () => {
  it("preserves an existing draft and appends the exact structured reply message", () => {
    expect(mergeReplyChipPrefill("Existing note", "Approve the exact slot.")).toBe(
      "Existing note\n\nApprove the exact slot.",
    );
    expect(mergeReplyChipPrefill("", "  Keep delivery.  ")).toBe("Keep delivery.");
  });

  it("renders native focusable buttons and never sends directly", () => {
    const html = renderToStaticMarkup(createElement(ReplyChips, {
      threadId: "thread-1",
      choices: [
        { id: "approve", label: "Approve", message: "Approve exactly as shown.", tone: "primary" },
        { id: "edit", label: "Edit", message: "Help me edit this first." },
      ],
    }));
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("Approve");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("href");
  });
});
