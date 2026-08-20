import { z } from "zod";

import type { Json, JsonObject, RuntimeEvent } from "../contracts.ts";
import { UI_LIMITS, type ComponentOrigin } from "./contract.ts";
import { uiToolNameFromTitle } from "./gallery.ts";

const MAX_PENDING_PER_THREAD = 32;
const CORRELATION_WAIT_MS = 2_000;
const JSON_OBJECT = z.record(z.string(), z.json());

type UiToolStart = {
  name: string;
  arguments: JsonObject;
  origin: ComponentOrigin;
};

type UiCallRequest = {
  threadId: string;
  name: string;
  arguments: JsonObject;
  provider: string;
  providerInstanceId?: string;
  providerCallId?: string;
};

type UiCallWaiter = {
  input: UiCallRequest;
  finish: (origin: ComponentOrigin) => void;
  timer: ReturnType<typeof setTimeout>;
};

function canonical(value: Json, depth = 0): string {
  if (depth > UI_LIMITS.depth) return "[depth-limit]";
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
  const object = JSON_OBJECT.safeParse(value);
  if (object.success) {
    return `{${Object.keys(object.data).sort().map((key) => `${JSON.stringify(key)}:${canonical(object.data[key]!, depth + 1)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function matches(start: UiToolStart, input: UiCallRequest, requireArguments: boolean): boolean {
  if (start.name !== input.name || start.origin.provider !== input.provider) return false;
  return !requireArguments || canonical(start.arguments) === canonical(input.arguments);
}

function mergedOrigin(input: UiCallRequest, matched?: UiToolStart): ComponentOrigin {
  const origin: ComponentOrigin = { provider: matched?.origin.provider ?? input.provider };
  const providerInstanceId = matched?.origin.providerInstanceId ?? input.providerInstanceId;
  if (providerInstanceId) origin.providerInstanceId = providerInstanceId;
  if (matched?.origin.turnId) origin.turnId = matched.origin.turnId;
  if (matched?.origin.itemId) origin.itemId = matched.origin.itemId;
  if (input.providerCallId) origin.providerCallId = input.providerCallId;
  return origin;
}

/** Joins the provider's native item identity to the MCP proxy call that
 * persisted the component. A short bounded wait covers either arrival order:
 * provider event first, or proxy HTTP call first. */
export class UiCallCorrelation {
  private pending = new Map<string, UiToolStart[]>();
  private waiters = new Map<string, UiCallWaiter[]>();

  record(event: RuntimeEvent): boolean {
    if (event.type !== "item.started" || event.itemType !== "tool") return false;
    const name = uiToolNameFromTitle(event.title);
    if (!name) return false;
    const origin: ComponentOrigin = { provider: event.provider };
    if (event.providerInstanceId) origin.providerInstanceId = event.providerInstanceId;
    if (event.turnId) origin.turnId = event.turnId;
    if (event.itemId) origin.itemId = event.itemId;
    const row: UiToolStart = { name, arguments: event.arguments ?? {}, origin };

    const waiting = this.waiters.get(event.threadId) ?? [];
    let index = waiting.findIndex((waiter) => matches(row, waiter.input, true));
    if (index < 0) index = waiting.findIndex((waiter) => matches(row, waiter.input, false));
    if (index >= 0) {
      const [waiter] = waiting.splice(index, 1);
      clearTimeout(waiter!.timer);
      if (waiting.length) this.waiters.set(event.threadId, waiting);
      else this.waiters.delete(event.threadId);
      waiter!.finish(mergedOrigin(waiter!.input, row));
      return true;
    }

    const rows = this.pending.get(event.threadId) ?? [];
    rows.push(row);
    if (rows.length > MAX_PENDING_PER_THREAD) rows.splice(0, rows.length - MAX_PENDING_PER_THREAD);
    this.pending.set(event.threadId, rows);
    return true;
  }

  claim(input: UiCallRequest): Promise<ComponentOrigin> {
    const rows = this.pending.get(input.threadId) ?? [];
    let index = rows.findIndex((row) => matches(row, input, true));
    if (index < 0) index = rows.findIndex((row) => matches(row, input, false));
    const matched = index >= 0 ? rows.splice(index, 1)[0] : undefined;
    if (rows.length) this.pending.set(input.threadId, rows);
    else this.pending.delete(input.threadId);
    if (matched) return Promise.resolve(mergedOrigin(input, matched));

    return new Promise((resolve) => {
      const finish = (origin: ComponentOrigin): void => resolve(origin);
      const timer = setTimeout(() => {
        const waiting = this.waiters.get(input.threadId) ?? [];
        const waiterIndex = waiting.findIndex((waiter) => waiter.finish === finish);
        if (waiterIndex >= 0) waiting.splice(waiterIndex, 1);
        if (waiting.length) this.waiters.set(input.threadId, waiting);
        else this.waiters.delete(input.threadId);
        finish(mergedOrigin(input));
      }, CORRELATION_WAIT_MS);
      const waiting = this.waiters.get(input.threadId) ?? [];
      waiting.push({ input, finish, timer });
      this.waiters.set(input.threadId, waiting);
    });
  }

  settle(threadId: string): void {
    this.pending.delete(threadId);
    const waiting = this.waiters.get(threadId) ?? [];
    this.waiters.delete(threadId);
    for (const waiter of waiting) {
      clearTimeout(waiter.timer);
      waiter.finish(mergedOrigin(waiter.input));
    }
  }
}
