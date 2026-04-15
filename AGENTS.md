# Repository Guidelines

## Start Here

- Read [`docs/README.md`](./docs/README.md) for the document map.
- Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before changing structure or moving code.
- Read [`docs/references/capabilities.md`](./docs/references/capabilities.md) before changing a command or capability.

## Project Layout

- `src/cli/`: command entrypoints
- `src/capabilities/`: current main capability implementations
- `src/core/`: shared runtime foundations
- `src/platform/`: providers, config, and external integrations
- `tests/`: Vitest suites mirroring source areas
- `docs/`: project knowledge and design history
- `dist/`: TypeScript build output, do not edit manually

## Working Rules

- Run `npm run test:run` and `npm run build` before handing work back.
- New or changed code should keep at least 80% line coverage in the files you touch. Check with `npm run test:coverage`.
- When changing commands, capabilities, or project structure, update the matching docs and run `npm run check:docs`.
- Planning and design docs live in `docs/plans/` and use `YYYY-MM-DD-<topic>.md`.
- Keep comments focused on why, not what.
- New or changed non-trivial code must include maintainable comments where future readers would otherwise need to infer hidden rules. Explain constraints, fallbacks, state transitions, and safety boundaries; do not add comments that only restate obvious code.

## Development Commands

- `npm run dev -- --help`
- `npm run test:run`
- `npm run test:coverage`
- `npm run build`
- `npm run lint`
- `npm run check:boundaries`
- `npm run check:docs`

## Change Mapping

- Command or CLI UX changes: update `README.md` and `docs/references/capabilities.md`
- Architecture or module-boundary changes: update `ARCHITECTURE.md`
- Workflow expectations or contributor rules: update `AGENTS.md`

## Security

- Never commit API keys or `.env` secrets.
- Configure providers via `~/.magpie/config.yaml` and environment variables.
- Use the `mock` provider when real model calls are unnecessary.
