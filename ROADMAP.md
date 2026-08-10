# Roadmap — pi-model-prompts

Status: active

Semver-disciplined. Versions are cited in parens; `M<n>` is the milestone
identity per crew convention. Findings from the 2026-07-02 adversarial review
live in `docs/AUDIT.md`. Locked design decisions live in [`DECISIONS.md`](./DECISIONS.md).

---

## Released

- **M1** — Correctness & hygiene (v1.0.1, 2026-07-02)
- **M2** — Per-model roles + `/role` picker (v1.1.0, 2026-07-02)

## Current

(none — no build in flight)

## Planned

- **Argument completions for `/role`** — complete variant names discovered in `~/.pi/agent/model-prompts/`, plus the `list`, `default`, and `test <provider>/<model>` verbs, via `getArgumentCompletions`; add a round-trip test asserting every suggestion the completer offers is accepted by the parser.

Further candidate backlog lives in [`IDEAS.md`](./IDEAS.md).
