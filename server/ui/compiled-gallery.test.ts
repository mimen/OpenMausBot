import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Json } from "../contracts.ts";
import { BoundedJsonObjectSchema, type JsonSchema } from "./contract.ts";
import { EventBridgePayloadSchema, OpsBridgePayloadSchema, OwedBridgePayloadSchema } from "./bridge.ts";
import { GALLERY, generativeUiSystemPrompt, privateUiTools } from "./gallery.ts";
import { COMPILED_COMPONENT_SCHEMAS } from "./schemas.ts";
import { validateArgs } from "./validate.ts";

const compiledNames = Object.keys(COMPILED_COMPONENT_SCHEMAS);

describe("compiled component gallery", () => {
  it("publishes every compiled schema in the private tool list and registry-derived primer", () => {
    const galleryNames = GALLERY.map((spec) => spec.name);
    const toolNames = privateUiTools().map((tool) => tool.name);
    const primer = generativeUiSystemPrompt();
    for (const name of compiledNames) {
      expect(galleryNames).toContain(name);
      expect(toolNames).toContain(name);
      expect(primer).toContain(name);
    }
    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  it("keeps the UI MCP surface private to per-turn integration code", () => {
    const root = join(import.meta.dirname, "..", "..");
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
    const proxy = readFileSync(join(root, "server", "drivers", "ui-proxy.ts"), "utf8");
    expect(proxy).not.toContain("homedir(");
    expect(proxy).not.toContain("writeFile");
    expect(proxy).toContain("OMB_UI_TOKEN");
  });

  it("mounts the registry primer only behind integrations.ui in one-to-one and room turns", () => {
    const root = join(import.meta.dirname, "..", "..");
    const server = readFileSync(join(root, "server", "index.ts"), "utf8");
    expect(server.match(/integrations\.ui \? `[^`]*\$\{generativeUiSystemPrompt\(\)\}/g)).toHaveLength(2);
    expect(server.match(/instance\.adapter\.capabilities\.uiMcp === true/g)).toHaveLength(2);
  });

  it("rejects unknown fields and malformed exact facts in every new schema", () => {
    for (const schema of Object.values(COMPILED_COMPONENT_SCHEMAS)) {
      expect(schema.safeParse({ unexpected: true }).success).toBe(false);
    }
  });

  it("rejects inbound nesting before recursive validation can overflow", () => {
    let nested: Json = "leaf";
    let nestedSchema: JsonSchema = { type: "string" };
    for (let depth = 0; depth < 100; depth += 1) {
      nested = [nested];
      nestedSchema = { type: "array", items: nestedSchema };
    }
    const schema: JsonSchema = {
      type: "object",
      additionalProperties: false,
      required: ["nested"],
      properties: { nested: nestedSchema },
    };
    expect(validateArgs(schema, { nested })).toMatchObject({ ok: false, error: expect.stringContaining("nesting depth") });

    let adversarial: Json = "leaf";
    for (let depth = 0; depth < 5_000; depth += 1) adversarial = [adversarial];
    expect(() => BoundedJsonObjectSchema.safeParse({ adversarial })).not.toThrow();
    expect(BoundedJsonObjectSchema.safeParse({ adversarial }).success).toBe(false);
  });
});

describe("structured bridge readiness", () => {
  it("accepts authoritative Ops facts without a prose summary", () => {
    expect(OpsBridgePayloadSchema.safeParse({
      version: 1,
      kind: "ops_status",
      source: "ops-watch",
      deliveryId: "ops-1",
      checkedAt: "2026-08-20T12:00:00Z",
      changedKeys: ["finding-1"],
      standingOpenCount: 1,
      findings: [{
        id: "finding-1",
        group: "new",
        label: "A finding",
        severity: "warning",
        owner: "Milad",
        nextMove: "Decide.",
      }],
    }).success).toBe(true);
  });

  it("accepts exact bounded Owed and Event facts", () => {
    expect(OwedBridgePayloadSchema.safeParse({
      version: 1,
      kind: "owed_conversations",
      source: "inbox-closer",
      deliveryId: "owed-1",
      checkedAt: "2026-08-20T12:00:00Z",
      changedKeys: ["chat-1"],
      standingOpenCount: 1,
      conversations: [{
        id: "chat-1",
        contact: "Leah",
        surface: "imessage",
        age: "2h",
        stakes: "high",
        owner: "Milad",
        owedReason: "A promised answer is due.",
        bubbles: [{ id: "m1", direction: "inbound", text: "Any update?", at: "2026-08-20T11:00:00Z" }],
        draft: { body: "Draft answer", status: "draft" },
        nextMove: "Edit the draft.",
      }],
    }).success).toBe(true);
    expect(EventBridgePayloadSchema.safeParse({
      version: 1,
      kind: "event_portfolio",
      source: "event-watch:coordinator",
      deliveryId: "event-1",
      checkedAt: "2026-08-20T12:00:00Z",
      changedKeys: ["event-1:blocker"],
      standingOpenCount: 1,
      events: [{
        eventId: "event-1",
        slug: "event-one",
        title: "Event One",
        doorsAt: "2026-08-22T21:00:00-07:00",
        timeZone: "America/Los_Angeles",
        health: "watch",
        blockers: [{ id: "b1", label: "Open blocker", status: "open", nextMove: "Resolve it." }],
        draftReadyLinks: [],
        nextMove: "Resolve the blocker.",
      }],
    }).success).toBe(true);
  });
});
