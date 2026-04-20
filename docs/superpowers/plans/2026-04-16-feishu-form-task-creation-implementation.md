# Feishu Form Task Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Feishu group members send `/magpie form`, submit a message card, and create a task through the same launch path already used by `/magpie task`.

**Architecture:** Add a lightweight form-open command and a new card-submit callback type inside the Feishu IM bridge. Normalize both command entry and form entry into the same `TaskCreationRequest`, then reuse the current task launch, mapping, and status-update flow.

**Tech Stack:** TypeScript, Node HTTP server, existing Feishu IM client, existing loop and harness launch helpers, Vitest

---

## File Structure

- Modify: `src/platform/integrations/im/types.ts`
- Modify: `src/platform/integrations/im/feishu/events.ts`
- Modify: `src/platform/integrations/im/feishu/task-command.ts`
- Create: `src/platform/integrations/im/feishu/task-form.ts`
- Modify: `src/cli/commands/im-server.ts`
- Modify: `tests/platform/im/feishu-events.test.ts`
- Modify: `tests/platform/im/feishu-task-command.test.ts`
- Modify: `tests/cli/im-server-command.test.ts`
- Modify: `README.md`
- Modify: `docs/channels/feishu-im.md`
- Modify: `docs/references/capabilities.md`

## Task 1: Add dual-entry task request normalization

- [ ] Add a form submission event type to `src/platform/integrations/im/types.ts`.
- [ ] Extend `src/platform/integrations/im/feishu/events.ts` so `im.message.action.trigger` can normalize both confirmation actions and task-form submissions.
- [ ] Extend `src/platform/integrations/im/feishu/task-command.ts` with:
  - `entryMode: 'command' | 'form'`
  - `/magpie form` detection
  - form-field normalization that shares the same validation as command mode
- [ ] Write and run targeted tests in:
  - `tests/platform/im/feishu-events.test.ts`
  - `tests/platform/im/feishu-task-command.test.ts`

## Task 2: Publish the task form card

- [ ] Create `src/platform/integrations/im/feishu/task-form.ts` with a builder for the reply card opened by `/magpie form`.
- [ ] Keep the card limited to four fields:
  - `type`
  - `goal`
  - `prd`
  - `priority`
- [ ] Add one submit action that can be recognized by the callback parser.
- [ ] Keep the card explanatory enough that users know `priority` matters only for `formal`.
- [ ] Cover the open-form path in `tests/cli/im-server-command.test.ts`.

## Task 3: Reuse the existing launch flow from form submissions

- [ ] Update `src/cli/commands/im-server.ts` so:
  - `/magpie form` opens the interactive card
  - form submission validates and normalizes into `TaskCreationRequest`
  - valid submissions call `launchFeishuTask`
  - invalid submissions reply with a clear rejection
  - launch prerequisite failures reuse the current user-facing rejection path
- [ ] Verify command mode still works unchanged.
- [ ] Add focused regression tests in `tests/cli/im-server-command.test.ts`.

## Task 4: Document the third-stage entry mode

- [ ] Update `docs/channels/feishu-im.md` to describe both entry modes and the new `/magpie form` flow.
- [ ] Update `README.md` and `docs/references/capabilities.md` so command help reflects dual-entry task creation.
- [ ] Run `npm run check:docs`.

## Task 5: Final verification

- [ ] Run focused IM tests first.
- [ ] Run full project checks:
  - `npm run test:run`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run lint`
- [ ] Confirm touched files keep the required coverage bar.
