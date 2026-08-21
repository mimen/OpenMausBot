import assert from "node:assert/strict";
import test from "node:test";
import { initialUpdateState, UPDATE_POLICY } from "./updater-policy.mjs";

test("custom builds disable the upstream update channel", () => {
  assert.equal(UPDATE_POLICY.enabled, false);
  assert.deepEqual(initialUpdateState(), {
    status: "disabled",
    message: "Updates are managed manually for this custom build.",
  });
});
