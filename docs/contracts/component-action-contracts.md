# Compiled component action contracts

The executable event schema is `ComponentActionEventSchema` in `server/ui/contract.ts`. Persistence and delivery live in `server/ui/action-db.ts`.

## Public durable event

```json
{
  "actionId": "uuid or server id",
  "idempotencyKey": "stable action identity",
  "threadId": "thread id",
  "callId": "component call id",
  "botId": "optional room member or one-to-one bot id",
  "componentName": "show_* name",
  "actionName": "typed action name",
  "entity": { "id": "public entity id", "label": "bounded label" },
  "result": { "summary": "bounded public result" },
  "status": "started | succeeded | failed",
  "trustedOrigin": "electron_main | same_origin_browser | recovery",
  "createdAt": "ISO 8601 timestamp",
  "updatedAt": "ISO 8601 timestamp",
  "deliveryCursors": {
    "provider:instance": {
      "deliveredAt": "ISO 8601 timestamp",
      "turnId": "provider turn id"
    }
  },
  "execution": {
    "attempt": 1,
    "leaseUntil": "optional ISO 8601 timestamp"
  },
  "followUp": {
    "status": "pending | claimed | dispatched | failed",
    "attempt": 0,
    "claimedUntil": "optional ISO 8601 timestamp",
    "dispatchedAt": "optional ISO 8601 timestamp",
    "error": "optional bounded dispatch error"
  }
}
```

No credential, remote-write token, Electron secret, MCP bearer, or action capability may enter this event.

Terminal events are injected once per provider instance into resumed or replayed context in chronological batches of at most 24. A default `ui_action` continuation runs once per thread batch with the selected model and effort, but only the private compiled UI tools are mounted. Completed actions are consumed and cannot execute again without a separately verified retry claim. Follow-up dispatch has three bounded attempts.

## Todoist completion

- Action name: `complete_task`.
- Idempotency key: `todoist:{threadId}:{callId}:complete:{canonicalTaskId}`.
- External write owner: Electron main only.
- The server durably claims the action before Electron may call Todoist.
- A live started or failed lease, or a succeeded key, never licenses another remote close. A failed action keeps a 30-second ambiguity window. After expiry, a started or failed key can be reclaimed only when completed-task history is negative and read-only Todoist checks prove the task is still active and, for recurring tasks, still on the shown occurrence.
- Electron's successful close response is the immediate authority. Completed-task history settles a crash-before-report recovery without re-executing the close.
- Recurring tasks store the shown due date and recurring flag. Recovery may settle from completed-task history or an advanced due occurrence. It never retries the close on ambiguity.

## Supplement ledger toggle

- Action names: `tick_item` and `untick_item`.
- Origin: same-origin browser request with an explicit loopback `Origin` and `application/json` content type.
- Idempotency key: `supplement:{actionId}` where the browser mints `actionId` once per click.
- State key: local date, regimen version, and item id.
- Situational items reject normal daily ticks.
- The action updates only local SQLite state and the shown component snapshot. It never edits the regimen source or vault protocol.

## Future Google Calendar proposal approval

No handler exists in this slice. `show_week_calendar` uses ReplyChips to compose a user message instead.

A later trusted handler must accept exactly this payload:

```json
{
  "actionId": "browser or Electron minted UUID",
  "threadId": "owning OpenMaus thread",
  "callId": "show_week_calendar call id",
  "actionName": "approve_week_calendar_proposal",
  "proposalHash": "sha256 of canonical proposal fields below",
  "calendarId": "explicit target calendar id",
  "weekStart": "YYYY-MM-DD",
  "timeZone": "IANA time zone",
  "events": [
    {
      "proposalEventId": "stable proposal-local id",
      "title": "exact event title",
      "startsAt": "ISO 8601 timestamp with offset",
      "endsAt": "ISO 8601 timestamp with offset",
      "location": "optional exact location",
      "notes": "optional exact notes"
    }
  ],
  "exclusions": ["exact excluded proposal ids or immutable constraints"]
}
```

Required rules for that later slice:

1. The server re-reads the stored `show_week_calendar` call and recomputes `proposalHash` from `calendarId`, `weekStart`, `timeZone`, ordered events, and ordered exclusions.
2. Every event in the action must match a proposed chip in the stored component. Existing or conflict chips cannot be written.
3. The target calendar and each exact event are authorized before any write.
4. Electron main or another separately reviewed trusted adapter owns the Calendar credential and write.
5. The idempotency key is `google-calendar:{threadId}:{callId}:{proposalHash}`.
6. A partial batch records per-event public results and never silently retries an ambiguous write.
7. The resulting terminal action event follows the public schema above and contains no Google credential or write capability.
