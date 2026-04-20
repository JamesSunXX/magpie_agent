# Feishu Form Task Creation Design

## Goal

Add the third-stage Feishu task entry mode: any group member can send `/magpie form`, receive a task-creation card, submit structured fields, and create a new Magpie task through the same downstream path already used by command-style task creation.

## Scope

This design covers only the in-group message-card flow:

- open the form by sending `/magpie form`
- render a reply card with `type`, `goal`, `prd`, and `priority`
- submit the card back through Feishu callback events
- normalize form input into the existing internal task request shape
- reuse the existing thread creation, task launch, mapping persistence, and status reply flow

Out of scope:

- permanent pinned cards in the group
- standalone Feishu form products
- free-form natural-language task creation
- changing approval whitelist rules for human confirmation

## User Flow

1. A group member sends `/magpie form`.
2. `magpie im-server` recognizes the message as a form-open request.
3. Magpie replies in-thread with an interactive card.
4. The user fills:
   - `type`: `small` or `formal`
   - `goal`
   - `prd`
   - `priority` (only meaningful for `formal`)
5. The user submits the card.
6. The Feishu bridge validates the submission and normalizes it into the same `TaskCreationRequest` shape already used by `/magpie task`.
7. The existing task launch path creates the real task thread, binds the session, and posts status updates there.

## Architecture

The existing Feishu IM integration remains the single entry point. The only change is adding a second task-entry mode before the already-shipped launch path:

- text command entry:
  `/magpie task` -> parse command -> `TaskCreationRequest`
- form entry:
  `/magpie form` -> publish card -> parse submit callback -> `TaskCreationRequest`

Both paths must converge before task launch. The launch logic, thread mapping persistence, lifecycle replies, and downstream workflow routing stay unchanged.

## Event Model

Add one new inbound event kind for Feishu card submission:

- `task_form_submission`

Required callback data:

- `eventId`
- `actorOpenId`
- `threadKey`
- `chatId`
- submitted field values

The existing `task_command` event kind remains unchanged for inbound text messages. `/magpie form` is detected inside the IM server dispatch layer rather than adding a separate wire-level event type.

## Validation Rules

Normalization rules must match the existing command mode:

- `type` is required and must be `small` or `formal`
- `goal` is required
- `prd` is required
- `priority` is optional
- `priority` is accepted only from the existing supported set
- `small` routes to `loop`
- `formal` routes to `harness`

The normalized request must differ only in `entryMode: 'form'`.

## Failure Semantics

- Invalid form input returns a clear rejection reply in the current thread.
- If task launch is blocked by missing runtime prerequisites, Magpie replies with the same clear failure used by command mode.
- No task thread is created before launch prerequisites pass.
- Duplicate callback delivery is ignored using the existing processed-event store.
- Human confirmation permissions remain unchanged and still apply only to approval actions.

## Testing

Required coverage:

- `/magpie form` opens a card
- form submission callback normalizes correctly
- invalid form submissions are rejected with a clear reply
- valid form submissions reuse the existing launcher path
- duplicate form callbacks do not apply twice
- command mode still behaves the same after dual-entry support is added
