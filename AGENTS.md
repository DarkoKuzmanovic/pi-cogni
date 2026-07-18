# AGENTS.md — pi-model-prompts

Maintainer/agent contract. The companion file to `README.md` (user-facing):
this one documents how the code is shaped and how to verify changes.

## Architecture

Three-tier prompt matching, plus a role-variant overlay:

1. **Exact provider + model** — `{provider}--{modelId}.md` matches `provider/modelId`
2. **Exact model** — `{modelId}.md` matches `provider/modelId`
3. **Fuzzy bounded segment** — filename stem appears as a dash-bounded segment of the normalized model id after `:`, `/`, `\` → `-`

**Role variants** (`{stem}@{variant}.md`): parsed at load into
`{baseStem, variant}` pairs. The base stem goes through the matching tiers;
the `@variant` suffix selects which file is injected.

**Persistence:** `~/.pi/agent/model-prompts/active.json`, keyed by
`provider/model`. Missing key = `"default"`.

**HUD status:** `ctx.ui.setStatus("model-prompts", `role: ${activeVariant ?? "default"}`)`
on `session_start`, `before_agent_start`, and after `/role` switches.

**Sentinel markers:** injected content is wrapped in
`<!-- model-prompts: begin ... end ... -->` so the source is visible in the
system prompt.

## Invariants

- Prompt files are read fresh on each turn. C1 in v1.0.1 deleted the previous
  permanent-content memoization after it caused mid-session edits to silently
  stick.
- Sentinel markers bracket every injected block.
- Reserved subcommand keywords: `list`, `test`, `default` cannot be variant
  names.
- An empty matched file injects nothing. Chosen over silent shadowing of a
  populated fuzzy match (see `docs/AUDIT.md` §C2).
- Fuzzy stems must be ≥3 characters; ties break by longest stem, deterministic
  via `localeCompare`.

## Verification

Run before any commit:

- `npm test` — 58 tests, 10 suites, must be green.
- `npm run typecheck` — `tsc --noEmit` against `model-prompts.ts` +
  `model-prompts.test.ts`. Must be clean.

CI is not yet configured (was a v1.0.1 backlog item; track in GitHub issues
if pursued).

## Known hazards

- `*-precision.md` / `*-worker.md` filenames longer than the model id never
  engage the fuzzy rule — the stem is longer than the model id, so the
  dash-bounded segment match fails. Use `mimo-v2.5-pro@precision.md` (with
  `@`), not `mimo-v2.5-pro-precision.md` (with `-`).
- Do not reintroduce permanent memoization of prompt content without a
  focused freshness test. The C1 bug was discovered because the cached
  content silently shadowed mid-session edits.
- Adding any new tier to the matcher changes the precedence contract —
  update `model-prompts.test.ts` + the README "Matching rules" section in
  the same commit.
- The `model-prompts` status key is referenced by pi-hud
  (`pi-hud.layout.jsonc` `ext:model-prompts` and `pi-hud/render/blocks.ts`
  `HIDDEN_STATUSES`). Don't rename it without coordinating with pi-hud.
