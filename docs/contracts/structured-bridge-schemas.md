# OpenMaus structured bridge payloads

The canonical executable schemas are in `server/ui/bridge.ts`. Bridge producers should validate against those schemas before delivery. OpenMaus still runs the receiving model turn so the model can choose relevance, priority, grouping, explanation, component composition, and the next move. The model does not need to recover exact facts from prose.

## Shared envelope

Every payload has these fields:

```json
{
  "version": 1,
  "kind": "ops_status | owed_conversations | event_portfolio",
  "source": "source-specific literal",
  "deliveryId": "stable producer idempotency key",
  "checkedAt": "ISO 8601 timestamp",
  "changedKeys": ["bounded stable item keys"],
  "summary": "optional short fallback for older OpenMaus runtimes"
}
```

Bounds:

- IDs and timestamps: 1 to 200 characters.
- `changedKeys`: at most 100 entries.
- Free text fields use the component transcript limits in `server/ui/contract.ts`.
- Extra fields are rejected.

## Ops Watch payload

`kind` is `ops_status`. `source` is `ops-watch`.

```json
{
  "version": 1,
  "kind": "ops_status",
  "source": "ops-watch",
  "deliveryId": "ops-watch:2026-08-20T17:00:00Z",
  "checkedAt": "2026-08-20T17:00:00Z",
  "changedKeys": ["heroku:deploy", "readyrefresh:token"],
  "standingOpenCount": 3,
  "previousOpenCount": 5,
  "findings": [
    {
      "id": "readyrefresh:token",
      "group": "new",
      "label": "ReadyRefresh token ages out tomorrow",
      "severity": "warning",
      "since": "today",
      "owner": "Milad",
      "evidence": "The current session expires before the next delivery window.",
      "nextMove": "Choose keep or skip after checking bottle count.",
      "service": "ReadyRefresh"
    }
  ],
  "quietState": {
    "label": "Everything checked is healthy.",
    "detail": "No standing item needs attention."
  }
}
```

`group` is one of `resolved`, `new`, `awaiting`, `still_open`, or `healthy`. `severity` is one of `healthy`, `info`, `warning`, `serious`, or `critical`.

This payload maps without prose parsing into `show_status_board`. The model remains responsible for selecting which findings deserve the board and writing the decision-ready summary.

## Inbox Closer payload

`kind` is `owed_conversations`. `source` is `inbox-closer`.

```json
{
  "version": 1,
  "kind": "owed_conversations",
  "source": "inbox-closer",
  "deliveryId": "inbox-closer:2026-08-20T17:05:00Z",
  "checkedAt": "2026-08-20T17:05:00Z",
  "changedKeys": ["imessage:leah:event-logistics"],
  "standingOpenCount": 4,
  "coverageGaps": ["Instagram collection scan is delayed."],
  "conversations": [
    {
      "id": "imessage:leah:event-logistics",
      "contact": "Leah",
      "surface": "imessage",
      "age": "2 hours old",
      "stakes": "high",
      "owner": "Milad",
      "owedReason": "Milad promised the exact guest-list count today.",
      "bubbles": [
        {
          "id": "message-1",
          "direction": "inbound",
          "text": "Can you confirm the final guest-list count before 6?",
          "at": "2026-08-20T14:42:00-07:00"
        }
      ],
      "draft": {
        "body": "Final count is 42. That includes the two artist guests and excludes staff credentials.",
        "status": "needs_edit"
      },
      "nextMove": "Edit, then request the claude-actions approval surface."
    }
  ]
}
```

`surface` is one of `imessage`, `whatsapp`, `instagram`, `slack`, `email`, `sms`, or `other`. `stakes` is one of `low`, `medium`, `high`, or `critical`. Bubbles are bounded to 16 per conversation and keep exact direction, text, and timestamp.

This payload maps without prose parsing into `show_conversation`. The model chooses the highest-value conversation, narrative emphasis, and reply chips. It must never send directly.

## Event Watch payload

`kind` is `event_portfolio`. `source` is `event-watch:coordinator`.

```json
{
  "version": 1,
  "kind": "event_portfolio",
  "source": "event-watch:coordinator",
  "deliveryId": "event-watch:2026-08-20T17:10:00Z",
  "checkedAt": "2026-08-20T17:10:00Z",
  "changedKeys": ["glizzy-galaxy:credentials"],
  "standingOpenCount": 2,
  "events": [
    {
      "eventId": "event-glizzy-galaxy",
      "slug": "glizzy-galaxy",
      "title": "Glizzy Galaxy",
      "doorsAt": "2026-08-22T21:00:00-07:00",
      "timeZone": "America/Los_Angeles",
      "owner": "Event team",
      "health": "at_risk",
      "blockers": [
        {
          "id": "credentials",
          "label": "Artist credentials",
          "status": "open",
          "owner": "Leah",
          "evidence": "Two names are still unconfirmed.",
          "nextMove": "Confirm by Friday noon."
        }
      ],
      "draftReadyLinks": [
        {
          "id": "door-brief",
          "label": "Door brief draft",
          "url": "https://example.com/door-brief"
        }
      ],
      "nextMove": "Approve the guest-list count, then hand the door brief to venue staff."
    }
  ]
}
```

`health` is one of `healthy`, `watch`, `at_risk`, or `critical`. Blocker status is `completed` or `open`.

This payload maps without prose parsing into `show_event_countdown`. The model chooses the event, grouping, explanation, and next move while timestamps, owners, blockers, and links stay authoritative.

## Main-session integration change

The bridge producers under `/Users/mimen/Documents/milad-vault/ClaudeConfig/openmaus/bridges/` currently send a prose `summary`. The main session should adopt the source-specific payload above as the authenticated webhook data. It may keep a short display summary during migration, but exact counts, ids, timestamps, owners, statuses, bubbles, drafts, blockers, and links must come from the typed fields.

No vault bridge contract was edited in this branch.
