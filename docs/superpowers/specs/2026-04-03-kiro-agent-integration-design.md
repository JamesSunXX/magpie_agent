# Kiro Agent Integration Design

## Summary

Magpie will support selecting a specific Kiro agent whenever the runtime provider is `kiro`. The project-managed Kiro configuration source lives at `agents/kiro-config` and is treated as the canonical shared source for agents, prompts, skills, and hooks.

Because the referenced resources inside the Kiro agent files use absolute `~/.kiro/...` paths, Magpie will not try to run directly from the repository copy. Instead, Magpie will perform a lightweight preflight check before any Kiro invocation and will run `agents/kiro-config/install.sh` only when the local `~/.kiro` installation is missing, stale, incomplete, or does not contain the requested agent.

The runtime agent-selection rules are:

1. Explicit `agent` configuration wins.
2. If `agent` is not configured, Magpie attempts same-name matching from the logical config entry name.
3. If the desired agent is still missing after install, Magpie falls back to `kiro_default`.

This behavior applies everywhere in Magpie that resolves to the Kiro provider, not only review flows.

## Goals

- Allow every Kiro-backed role in Magpie to bind to a specific Kiro agent.
- Make `agents/kiro-config` the project-managed source of truth.
- Ensure Kiro resources are installed into `~/.kiro` only when needed.
- Keep the user experience automatic for normal Kiro usage.
- Avoid overwriting unrelated user-managed files under `~/.kiro`.

## Non-Goals

- Reworking non-Kiro provider behavior.
- Supporting direct execution from repository-local agent files.
- Managing private Kiro settings such as `config.json`, `settings/`, or session history.
- Forcing users to run a separate manual sync step before Kiro can be used.

## Current Constraints

- Kiro chat supports `--agent <name>`.
- Repository-managed agent files under `agents/kiro-config` reference prompts, skills, and hooks using absolute `~/.kiro/...` paths.
- Kiro’s local discovery behavior is tied to its expected home/workspace layout and is not reliable enough for Magpie to depend on as an implicit runtime mechanism.
- The current Magpie config model can express `model: kiro` but cannot distinguish multiple Kiro agents.

## Proposed Architecture

### 1. Project-managed Kiro source

`agents/kiro-config` remains the shared, versioned source that Magpie expects to use. In practice this should be tracked as a Git submodule so the project can pin and update the Kiro config bundle intentionally.

Magpie treats the following repository directories as managed install sources:

- `agents/kiro-config/agents`
- `agents/kiro-config/prompts`
- `agents/kiro-config/skills`
- `agents/kiro-config/hooks`

### 2. Kiro install manager inside Magpie

Before any Kiro provider call, Magpie runs a lightweight install-state check:

- Is `agents/kiro-config` present?
- Are the managed directories present under `~/.kiro`?
- Is the requested agent present under `~/.kiro/agents`?
- Does the installed metadata match the current repository version?

If all checks pass, Magpie runs Kiro immediately.

If any required check fails, Magpie invokes `agents/kiro-config/install.sh`, validates the result, then proceeds.

### 3. Agent selection at provider boundary

The Kiro provider resolves an agent name before invoking `kiro chat`:

1. Use explicitly configured `agent` when present.
2. Otherwise try same-name matching using the logical config entry name.
3. If the resolved agent is unavailable after install, use `kiro_default`.

This logic lives at the provider/config boundary so every Kiro-backed capability gets the same behavior automatically.

## Configuration Design

### Config shape

Magpie keeps `model: kiro` and adds an optional `agent` field anywhere a Kiro-backed logical role is configured.

Examples of config entries that may specify `agent`:

- `reviewers.<id>`
- `analyzer`
- `summarizer`
- capability-specific Kiro-backed entries added in the future

Example:

```yaml
reviewers:
  go-review:
    model: kiro
    agent: go-reviewer
    prompt: |
      Review Go changes carefully.

analyzer:
  model: kiro
  agent: architect
  prompt: |
    Analyze the change before review.
```

### Backward compatibility

- Existing `model: kiro` config remains valid.
- If `agent` is omitted, Magpie falls back to same-name matching.
- Non-Kiro models ignore the `agent` field even if present.

## Runtime Resolution Rules

### Agent resolution

Given a logical Magpie config entry:

1. Read `model`.
2. If the resolved runtime provider is not Kiro, stop.
3. Determine desired agent:
   - `config.agent` if present
   - otherwise the logical entry id/name
4. Ensure Kiro install state is valid.
5. Check whether desired agent exists in `~/.kiro/agents`.
6. If present, invoke `kiro chat --agent <desired-agent>`.
7. If absent, invoke `kiro chat --agent kiro_default` and emit a warning.

### Install-check rules

Magpie should trigger install when any of the following is true:

- Any managed install directory is missing in `~/.kiro`.
- Install metadata is missing.
- Install metadata points to a different source version.
- The desired agent does not exist in `~/.kiro/agents`.

Magpie should skip install when all required conditions pass.

### Failure handling

- If `agents/kiro-config` is missing, fail with a clear project-setup error instead of silently pretending the managed source exists.
- If install is required but `install.sh` fails, fail with a clear sync error.
- If install succeeds but the desired agent is still missing, fall back to `kiro_default` and warn.

## Install Script Design

`agents/kiro-config/install.sh` should become an idempotent sync tool rather than a “copy once unless forced” helper.

### Required behavior

- Sync only managed content from the repository source:
  - `agents`
  - `prompts`
  - `skills`
  - `hooks`
- Ignore backup/noise files such as `.DS_Store`, `*.bak`, and `*.backup`.
- Never delete unrelated user-managed files outside the managed source set.
- Write install metadata after a successful sync.

### Content-aware overwrite behavior

For each managed file:

- If destination file does not exist: copy it.
- If destination content is identical: skip it and do not back it up.
- If destination content differs: back it up, then overwrite it.

This avoids pointless backups and reduces churn under `~/.kiro`.

### Backup policy

Back up only changed files to a Magpie-owned backup directory, for example:

`~/.kiro/.magpie-backups/<timestamp>/...`

Rules:

- Preserve relative paths so backups are easy to inspect or restore.
- Do not create a backup directory when nothing changed.
- Do not back up files that are byte-for-byte identical.

### Install metadata

After a successful sync, write a small metadata file under `~/.kiro` that records at least:

- source path
- source version marker
- last installed timestamp

The source version marker should be derived from the repository-managed Kiro config state. The preferred source is the submodule commit if available; otherwise use a deterministic content fingerprint over the managed source files.

## Version Detection Strategy

Magpie should prefer a cheap and stable version signal:

1. If `agents/kiro-config` is a Git submodule with a resolvable pinned commit, use that commit as the installed version marker.
2. Otherwise compute a deterministic fingerprint from managed source files.

This gives clear behavior for both the intended submodule case and temporary local-development states.

## Implementation Boundaries

### Magpie code changes

Expected change areas:

- config types and loader validation to allow optional `agent`
- Kiro provider options and invocation path
- provider factory/config handoff so logical entry metadata can reach the Kiro provider
- shared Kiro install-check utility
- user-facing warning/error messages

### Install script changes

Expected change areas:

- compare source and destination file content
- create backups only for changed files
- write and validate install metadata
- support clear exit behavior for “already up to date” vs “synced successfully” vs “failed”

## User Experience

### Happy path

- User config selects Kiro.
- Magpie checks install state quickly.
- If already current, Magpie runs immediately with the requested agent.

### Stale install path

- User config selects Kiro.
- Magpie detects missing/stale install state.
- Magpie runs `install.sh`.
- Magpie validates requested agent presence.
- Magpie starts Kiro with the resolved agent.

### Missing agent path

- User config selects Kiro.
- Requested agent is not available even after install.
- Magpie warns clearly and falls back to `kiro_default`.

## Testing Strategy

### Unit tests

- config validation accepts optional `agent`
- non-Kiro configs ignore `agent`
- explicit agent beats auto-match
- auto-match uses logical config entry name
- missing target agent falls back to `kiro_default`
- install metadata mismatch triggers sync
- metadata match skips sync

### Script-focused tests

- unchanged files are skipped without backup
- changed files are backed up and overwritten
- missing files are copied
- unrelated destination files are untouched
- metadata is written after successful sync

### Integration tests

- Kiro invocation includes `--agent <name>` when resolved
- stale install state triggers `install.sh` before Kiro invocation
- failed install surfaces a clear error
- missing desired agent after install falls back to `kiro_default`

## Rollout Notes

- The repository should formally track `agents/kiro-config` as a submodule before relying on commit-based version detection.
- Until then, content fingerprint fallback keeps the feature usable in local development.
- README and init/help text should be updated when implementation lands so users understand how Kiro agent selection works.

## Decisions Confirmed

- This applies to all Kiro-backed usage in Magpie, not only review.
- `agents/kiro-config` is the project-managed source.
- Runtime should rely on `~/.kiro`, not direct repository-local execution.
- Magpie should auto-check install state before Kiro use.
- Install should happen only when needed.
- Explicit `agent` config wins.
- Same-name matching is the default fallback when `agent` is omitted.
- Project-managed config should override conflicting local content by backing up changed files, then overwriting them.
- If the requested agent is unavailable after sync, Magpie falls back to `kiro_default`.
