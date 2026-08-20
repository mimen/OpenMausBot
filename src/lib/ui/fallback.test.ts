import { describe, expect, it } from "vitest";

import { componentFallback } from "./fallback";

describe("componentFallback", () => {
  it("keeps a renderer failure from looking like a blank chat", () => {
    expect(componentFallback("show_quote", "This component failed to draw. The rest of the chat is unaffected.")).toEqual({
      title: "show_quote",
      body: "This component failed to draw. The rest of the chat is unaffected.",
    });
  });
});
