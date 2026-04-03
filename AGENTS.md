# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the TypeScript CLI and core logic. Key areas include `src/commands/` (CLI commands), `src/orchestrator/` (debate flow), `src/providers/` (LLM backends), `src/context-gatherer/`, and `src/reporter/`.

`tests/` mirrors source areas with Vitest suites (for example, `src/orchestrator/*` -> `tests/orchestrator/*`).

`dist/` is compiler output from `tsc`; do not edit it manually. Planning/design docs live in `docs/plans/`.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev -- review 12345`: run CLI from source with `tsx` for local development.
- `npm test`: run tests in watch mode.
- `npm run test:run`: run tests once (preferred for CI and pre-PR checks).
- `npm run build`: compile TypeScript (`src/` -> `dist/`) and surface strict type errors.
- `npm link`: optionally expose local `magpie` binary globally after a successful build.

## Coding Style & Naming Conventions
- Language/tooling: TypeScript (`module: NodeNext`, `strict: true`).
- Style in existing code: 2-space indentation, single quotes, no semicolons.
- Filenames use kebab-case (`issue-parser.ts`, `repo-orchestrator.ts`).
- Test files use `*.test.ts` and should map to the module they verify.
- Keep imports ESM-compatible and prefer `import type` for type-only imports.

## Testing Guidelines
- Framework: Vitest.
- Place tests under matching folders in `tests/`.
- Prefer focused unit tests with explicit mocked providers (`vi.fn()`), then add e2e coverage in `tests/e2e/` when command flow changes.
- Run targeted checks during development, for example: `npm test -- tests/orchestrator/orchestrator.test.ts`.
- Before submitting changes, run at least `npm run test:run` and `npm run build`.

### Coverage Requirements
- **New/modified files must have ≥ 80% line coverage.** Check with: `npm run test:coverage`
- Write tests **before** implementation when possible — verify new tests fail first, then implement.
- If a change touches an existing file with low coverage, add tests for the lines you changed at minimum.
- CI enforces `npm run test:coverage`; review the coverage table in the output to confirm your files meet the threshold.

## Commit & Pull Request Guidelines
- Follow Conventional Commits seen in history: `feat: ...`, `fix: ...`, `docs: ...`, optionally with scope (`feat(config): ...`) and issue refs (`(#8)`).
- Keep commits focused and atomic; avoid mixing refactors with behavior changes.
- PRs should include:
  - concise problem statement and approach,
  - testing evidence (command + result),
  - linked issue(s),
  - sample CLI output/screenshots for UX-facing changes.

## Documentation Guidelines
- Design docs and plans go in `docs/plans/` with date prefix: `YYYY-MM-DD-<topic>.md`.
- When adding a new capability or workflow, update `README.md` (capability list and usage section).
- When changing CLI flags or commands, update the relevant help text in `src/commands/` and the README.
- Inline code comments: explain **why**, not **what**. Skip obvious comments.
- Public functions/types that form module boundaries should have JSDoc with a one-line summary.

## Security & Configuration Tips
- Never commit API keys or `.env` secrets.
- Configure providers via `~/.magpie/config.yaml` and environment variables.
- Use the `mock` provider for safe local workflow testing when real model calls are unnecessary.

## Project Basic Skills
- Baseline skill file: `skills/project-baseline/SKILL.md`
- Default autonomous loop mode in this project:
  - use `codex` as loop model
  - run with `--no-wait-human`
  - set `MAGPIE_CODEX_TIMEOUT_MS` (recommended `120000`) to avoid indefinite hangs
  - monitor execution in real time and report status changes
