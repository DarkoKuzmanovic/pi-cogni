# Ideas — pi-model-prompts

Uncommitted brainstorm backlog. Pick-and-choose; **not** authorized for
implementation. Promotion to a milestone still requires the normal
spec → grill → scope checkpoint → confirmation flow.

---

## Shared `@base`/`@shared` composition (PARKED 2026-07-02)

**Idea:** Compose prompt fragments via an `@base`/`@shared` include /
templating convention, so sibling files can share protocol blocks without
duplication.

**Why parked:** Adds an include/templating micro-language to a single-purpose
tool and re-introduces the C1 cache-invalidation problem one level up
(shared fragments would need to be read fresh, but composed results would
need re-invalidation when any fragment changes). Duplicated protocol blocks
across a few sibling files are mildly ugly and fine.

**Revisit trigger:** Only if duplication is proven to cause drift bugs (one
fragment updated, another missed). No major release is currently justified.
