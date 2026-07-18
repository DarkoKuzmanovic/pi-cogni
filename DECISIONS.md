# Decisions — pi-model-prompts

Append-only design decisions with rationale. Source for "why was it built this
way." See `ROADMAP.md` for the milestone ledger and [`docs/SPEC.md`](./docs/SPEC.md)
for the shipped design rationale.

---

## D1 — Persist role variants across restarts (2026-07-02)

**Context:** Per-model prompt variants (the v1.1.0 `/role` picker) need a
place to keep state. Two options were on the table: session-only (resets on
Pi restart) or persistent (`~/.pi/agent/model-prompts/active.json` keyed by
`provider/model`).

**Decision:** Persist `active.json` across restarts.

**Rationale:** The operator picks a role deliberately; session-only would
make every `/role` selection a one-shot that they would have to re-apply on
every restart. Persistence turns role choice into durable configuration.

## D2 — Keep per-model role state on `/model` switch (2026-07-02)

**Context:** When the user switches models mid-session, should the active role
follow the model or stick to the original model?

**Decision:** Keep per-model state.

**Rationale:** This is an automatic consequence of D1 — `active.json` is keyed
by `provider/model`, so each model carries its own role selection through
`/model` switches. No extra code needed.

## D3 — Rename `/model-prompt` to `/role` only (no compatibility alias) (2026-07-02)

**Context:** The pre-v1.1.0 diagnostic command was `/model-prompt`. The v1.1.0
variant picker expanded it into a subcommand grammar (`/role list`, `/role
test`, `/role default`, `/role <name>`).

**Decision:** Rename to `/role` only; no compatibility alias.

**Rationale:** Operator override of the parked lean. The shorter `/role` name
fits the new "pick a role for this model" mental model better than the old
"show me the model prompt" diagnostic. Removing `/model-prompt` is a breaking
surface change, accepted in v1.1.0 as pre-adoption personal tooling — there
are no external consumers yet. As a consequence, the subcommand keywords
`list`, `test`, and `default` become reserved and cannot be used as variant
names.

## D4 — Fall back to default file with notification when active role has no file (2026-07-02)

**Context:** If the user sets an active role via `/role <name>` but no
`{stem}@{name}.md` file exists yet (e.g. they set it before creating the
file), what should `before_agent_start` do? Three options: silent fallback to
the default file, notify-and-fallback, or notify-and-inject-nothing.

**Decision:** Notify and fall back to the default (no-`@`) file. Never silent;
never inject-nothing.

**Rationale:** Silent fallback hides the typo or premature pick — the user
would not know their `/role` choice was inactive. Inject-nothing leaves the
model without any prompt context, which is worse than the wrong prompt. The
notification makes the mismatch discoverable, and the default file is a safe
fallback because it always exists for any model that has been set up.
