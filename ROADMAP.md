# Roadmap — pi-model-prompts

Semver-disciplined. Findings referenced as `AUDIT §<section><n>` point at
`docs/AUDIT.md` (2026-07-02). No open GitHub issues at time of writing.

Ordering reflects dependencies: ship all correctness + hygiene work in one
patch, then **gate** the speculative variant feature on operator confirmation.

> Revised 2026-07-02 after an adversarial review (anthropic/claude-fable-5).
> The original four-release plan over-engineered the C1 fix and roadmapped two
> minors of speculative features on a bare "make it more useful" steer. Collapsed
> to one correctness patch + a gate. See `docs/AUDIT.md` → Review addendum.

---

## v1.0.1 — "Correctness & hygiene" (patch)

Bug fixes, tests, docs. The one behavior change (live edits) is a bug fix, so it
stays a patch.

- **Fix C1 by deleting the cache, not preserving it.** Remove the permanent
  `readPromptContent` memoization (`model-prompts.ts:70-79`); read the matched
  file each user prompt. A system-prompt-sized read per prompt is noise. Write
  the failing edit-mid-session test **first** — C1 is still "suspected," so prove
  it before fixing. AUDIT §C1.
- **Route the `/model-prompt` diagnostic through the same read path as
  injection.** Today the command reloads as a side effect, so the diagnostic and
  the actual injected content can disagree. Same-path read removes the class.
- **Add a multi-turn non-accumulation test.** Injection-doesn't-accumulate is
  only docs-verified (`extensions.md:538-546`); pin it at runtime so a host
  rebuild-semantics change can't silently degrade the extension.
- **Adjudicate C2 before touching it.** Decide whether an empty exact-match file
  means "disable prompts for this model" (→ document + keep) or is an accident
  that shadows a populated fuzzy match (→ skip empty, fall through). Only then add
  a test for the *chosen* semantics. AUDIT §C2.
- Add a fuzzy equal-length tie-break test (deterministic via `localeCompare`,
  `model-prompts.ts:133`, but currently uncovered).
- Fix stale README directory example — AUDIT §A2/§D1.
- Add minimal GitHub Actions CI (`node --test` + `tsc --noEmit`) — AUDIT §A3/§D2.
- Note the completed `mimo-v2.5-pro-precision.md` cleanup in the plan — AUDIT §D4.

**Acceptance:** editing a matched `.md` and submitting a new prompt injects the
new content with no `/reload`; diagnostic and injection agree by construction;
multi-turn + tie-break tests added; README matches `ls ~/.pi/agent/model-prompts`;
CI green on a clean checkout.
**Effort:** S (~1–2h). The C1 fix is a deletion, not new machinery.

## v1.1.0 — per-model variants / `/role` picker (minor) — SHIPPED 2026-07-02

**Ungated 2026-07-02: operator confirmed role-variants solve a friction they
actually hit** (switching one model between orchestrator / worker / precision
prompts without renaming files). Primary killer-feature candidate, AUDIT §B; the
full design is in `IMPLEMENTATION_PLAN.md`.

Blocked on locking the plan's four open decisions (`IMPLEMENTATION_PLAN.md:113-
120`) before coding. Then: TDD `findVariantMatch` (tier × variant), persist
`active.json` keyed by `provider/model`, add `/role` / `/role <name>` /
`/role default` / `/role list`, and a status-footer indicator.

**Acceptance:** the plan's criteria (`IMPLEMENTATION_PLAN.md:124-132`).
**Effort:** M (~+150 LOC + ~50 LOC tests, single file). Build on the v1.0.1
cache-deletion so newly-created variant files inject live without `/reload`.

---

_Dropped from the roadmap: the shared `@base`/`@shared` composition idea. It adds
an include/templating micro-language to a single-purpose tool and re-introduces
C1's cache-invalidation problem one level up. Duplicated protocol blocks across a
few sibling files are mildly ugly and fine. Revisit only if duplication is proven
to cause drift bugs. No major release is currently justified._
