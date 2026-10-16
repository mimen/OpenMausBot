import { describe, expect, it } from "vitest";

import { previewText } from "./preview-text";

describe("previewText", () => {
  it("drops markdown syntax from a reply", () => {
    expect(previewText("Here is a **fake** reply.\n\n- item one\n- item two\n\n```js\nconsole.log('x');\n```\n")).toBe(
      "Here is a fake reply. item one item two",
    );
  });

  it("keeps link text, inline code and headings as words", () => {
    expect(previewText("## Plan\nSee [the doc](https://x.dev) and run `pnpm test`.")).toBe(
      "Plan See the doc and run pnpm test.",
    );
  });

  it("leaves plain text and lone symbols alone", () => {
    expect(previewText("2 * 3 = 6, error: claude exited")).toBe("2 * 3 = 6, error: claude exited");
  });
});
