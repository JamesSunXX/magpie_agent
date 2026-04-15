---
name: code-comments
description: Add maintainable comments to new or changed code. Use this whenever you create or modify non-trivial code, especially when the change introduces hidden constraints, fallback logic, state transitions, protocol mapping, cleanup semantics, or safety boundaries. Do not wait for the user to explicitly ask for comments.
---

# Code Comments

Make touched code easier to maintain by adding the smallest set of comments that explains the parts future readers cannot safely infer from names alone.

This project-local skill mirrors the repository-managed version under `agents/kiro-config/skills/code-comments/SKILL.md` so project agents can trigger it directly from the workspace.

## When to Activate

- Writing new code with non-obvious control flow or constraints
- Changing behavior in existing code
- Refactoring logic that changes responsibilities or safety assumptions
- Adding workflow orchestration, retries, recovery, fallback, routing, or document-placement rules

## Core Rule

Comment the reason, guardrail, or invariant.

Do not comment obvious syntax, assignments, or direct pass-through code.

## Scope

- Focus on files you touched for the current task
- Prefer adding comments to new code or behavior-changing edits
- Do not sweep unrelated files just to improve comments
- Do not invent behavior that the code does not actually implement

## What to Comment

### Module-level context

Add a short top-level comment or doc comment when a file has a non-obvious responsibility, coordinates several subsystems, or enforces important boundaries.

### Function and method context

Add or update a short doc comment when a function or method is exported, widely reused, stateful, protocol-heavy, or hard to understand from the signature alone.

Useful topics:
- What decision this function makes
- What safety boundary it protects
- Why a fallback exists
- What must already be true before calling it

### Inline comments

Add a short comment before a logic block when the block protects a hidden constraint, not just when it does something complicated.

Common triggers:
- Retry or idempotency rules
- Fallback selection
- State recovery conditions
- Cross-system path or document routing rules
- Dangerous-command blocking
- Temporary compatibility behavior

## What Not to Comment

- Single obvious statements
- Variable assignments that already read clearly
- Trivial test setup
- Restatements of the code in natural language
- Long prose that is harder to read than the code

## Style

- Match the dominant comment language and style of the file
- Keep comments shorter than the code they explain
- Prefer precise comments over broad “best practice” slogans
- Update or delete stale comments whenever behavior changes

## Review Checklist

Before finishing a task, confirm:

- The touched file has enough context for a future reader to understand the hidden rules
- Complex branches explain why they exist
- Fallbacks and recovery logic explain what they are protecting
- Comments still match the final code
- No comment was added only to describe the obvious

## Good Examples

```ts
// Preserve older artifact paths because later workflow stages append evidence
// incrementally and should not erase data recorded by earlier stages.
session.artifacts = {
  ...(existing.artifacts || {}),
  ...session.artifacts,
}
```

```ts
/**
 * Escalation only moves upward so runtime evidence cannot silently downgrade a
 * task after a harder route has already been selected.
 */
export function escalateRoutingDecision(...) {
```

## Bad Examples

```ts
const ids = await readdir(baseDir) // read directory
```

```ts
// Set score to 0
let score = 0
```
