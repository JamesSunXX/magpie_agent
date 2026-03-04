# Magpie Capability Architecture V2

## Goal

Reorganize the codebase from layer-first folders into capability-first architecture while keeping CLI behavior compatible.

## New Top-Level Structure

- `src/cli`: command registration and CLI surface.
- `src/core`: shared runtime kernels (capability lifecycle, state, context, reporting, repo abstractions).
- `src/capabilities`: capability modules (`review`, `discuss`, `trd`, `quality/unit-test-eval`).
- `src/platform`: provider/config/integration adapters.
- `src/shared`: cross-cutting utilities, errors, and common types.

## Capability Lifecycle

A capability implements:

1. `prepare(input, ctx)`
2. `execute(prepared, ctx)`
3. `summarize(result, ctx)`
4. `report(output, ctx)`

Runtime components:

- `src/core/capability/types.ts`
- `src/core/capability/registry.ts`
- `src/core/capability/runner.ts`
- `src/core/capability/context.ts`

## Configuration Migration

`src/platform/config/migration.ts` auto-migrates legacy config to V2 in memory:

- Adds `capabilities.review`
- Adds `capabilities.discuss`
- Maps `trd` to `capabilities.trd`
- Adds `capabilities.quality.unitTestEval`

Legacy `~/.magpie/config.yaml` continues to work.

## Quality Capability

New command:

```bash
magpie quality unit-test-eval [path]
```

Provides:

- source/test file discovery
- candidate unit-test generation suggestions
- optional test command execution (`--run-tests`)
- estimated coverage and weighted quality score

## Boundary Guard

`npm run check:boundaries` validates architectural dependency rules with legacy bridge allowlist for migrated CLI wrappers.

## Compatibility Notes

- Existing commands (`review`, `discuss`, `trd`, `stats`, `init`) stay compatible.
- Legacy modules remain available for compatibility and test stability.
- New capability modules are now the preferred extension surface for future features.
