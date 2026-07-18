# Audit Log — pi-model-prompts

Append-log, newest first. Each finding is backed by a `file:line` citation or a
command that was actually run.

---

## 2026-07-02

**Scope reviewed:** `model-prompts.ts` (385 lines), `model-prompts.test.ts`,
`README.md`, `docs/SPEC.md`, `package.json`.
**Operator friction supplied:** *"want to create something more useful"* — a
direction steer, not a concrete usage friction. Killer-feature confidence is
lowered accordingly (no observed pain points, only a "make it bigger" cue).

### Verification results

| Check | Command | Result |
|-------|---------|--------|
| Tests | `npm test` | **26/26 pass**, 0 fail |
| Typecheck | `npm run typecheck` | **Could not run** — `tsc: command not found`; `node_modules` absent (devDeps not installed). Not a code defect; the script assumes a local install. |
| Git hotspots | `git log --since=6mo --name-only …` | Top churn: `README.md` (7), `glm-5.1.md` (6), `qwen3.5.md` (4), `MiniMax-M2.7.md` (4), `pi-cogni.ts` (3). History shows this repo was renamed from `pi-cogni` and narrowed to `model-prompts` (commit `b7fb715`). Many of the churned `.md` files are prompt fixtures that no longer live in the repo. |
| Open issues | `gh issue list --state open` | **0 open issues** (gh authenticated, exit 0). |

### What this extension is

A single-purpose Pi extension: on `before_agent_start`, it matches the active
model against `~/.pi/agent/model-prompts/*.md` (exact provider+model → exact
model → fuzzy bounded-segment, longest stem wins) and appends the matched file
to the system prompt, wrapped in `<!-- model-prompts: begin/end -->` markers
(`model-prompts.ts:216-233`). A `/model-prompt` command shows the current match,
`list`, and `test <p>/<m>`. User = the operator, dogfooding per-model cognitive
protocols. The injection pattern mirrors the documented `claude-rules.ts`
example (`extensions.md:2646`) and is correct: `event.systemPrompt` is rebuilt
fresh each user prompt, so re-appending does **not** accumulate across turns
(`extensions.md:538-546`).

### A. Weak areas

1. **No composition / shared-fragment mechanism** — severity med × effort M.
   The prompt directory holds large near-identical protocol blocks across
   `claude-opus-4-6/-4-7/-4-8.md`, `umans-*.md`, etc. One model = exactly one
   file (`model-prompts.ts:220-231`); there is no way to factor shared
   instructions into a common fragment. Maintenance cost grows linearly with the
   roster and edits drift between siblings. Fix: an additive `@shared`/`_base.md`
   include appended to every match (see Killer feature, runner-up 2).

2. **Documentation drift** — severity low × effort S. `README.md:38-45` lists a
   sample directory (`kimi-k2.6.md`, `mimo-v2.5-pro-precision.md`,
   `deepseek-v4-pro-precision.md`) that does **not** match the live directory
   (`claude-*.md`, `deepseek-v4-pro.md`, `minimax-m3.md`, `umans-*.md`, verified
   via `ls ~/.pi/agent/model-prompts`). The old `IMPLEMENTATION_PLAN.md:176,182`
   cleanup-task section referenced `mimo-v2.5-pro-precision.md` as a live cleanup
   target, but that file was already gone and the cleanup-task section itself
   was removed during the 2026-07-19 canonical-convention migration (now
   `docs/SPEC.md`). Stale examples mislead the next reader about the contract.

3. **No CI / isolated typecheck** — severity low × effort S. There is no
   `.github/workflows`, and `npm run typecheck` cannot run without a local
   install (`tsc` not resolvable). For a published `pi-package`, a ~15-line
   workflow running `node --test` + `tsc --noEmit` would guard the matcher —
   which is the whole value of the extension — against regressions.

### B. Killer feature check

Confidence: **medium-low** (no concrete friction supplied; steer was "more
useful"). The single highest-leverage feature is **already designed and parked**
in `docs/SPEC.md` (formerly `IMPLEMENTATION_PLAN.md`, reorganized during the
2026-07-19 canonical-convention migration):

- **Primary — per-model prompt variants / `/role` picker.** Today one model = one
  file. The plan (`docs/SPEC.md`) adds `{model}@{variant}.md`
  naming, a `/role` TUI picker, a persisted `active.json`, and a status footer,
  so one model can carry switchable roles (orchestrator / worker / precision).
  It has acceptance criteria and a test plan already written. Tradeoff: +~150
  LOC and a new state file (`active.json`) — the first stateful surface in an
  otherwise stateless extension; needs care on the fallback-when-file-missing
  path (open decision #4 in the plan).

- **Runner-up 1 — hot-reload on file edit.** File-watch or mtime-invalidate the
  content cache so edits to a `.md` apply mid-session without `/reload`. Directly
  removes finding C1 and speeds the actual prompt-tuning loop (the operator's
  real workflow is editing these files). Tradeoff: a watcher is a session-scoped
  resource needing `session_shutdown` cleanup (`extensions.md:223`); mtime-check
  is simpler and nearly as good.

- **Runner-up 2 — shared composition (`@base`/includes).** Append a common
  fragment to every model match to DRY the near-duplicate protocol blocks.
  Tradeoff: introduces ordering/merge semantics; risk of scope creep toward a
  templating system. Keep it strictly "append one shared file," no logic.

### C. Bugs

1. **Mid-session edits not reflected in injection** — **suspected** (code trace,
   not runtime-reproduced). `readPromptContent` memoizes content permanently on
   the `PromptFile` object (`model-prompts.ts:70-79`). The module-level
   `promptFiles` array is reassigned only in `session_start`
   (`model-prompts.ts:213`) and inside the command handler
   (`model-prompts.ts:239`) — never in `before_agent_start`
   (`model-prompts.ts:216-233`). Failure scenario: user edits
   `~/.pi/agent/model-prompts/glm-5.1.md` mid-session and submits another prompt
   without `/reload` or running `/model-prompt`; the stale cached body is
   injected. Confusingly, running `/model-prompt` (which reloads as a side
   effect) then shows the *new* content — so the diagnostic and the actual
   injection can disagree. Fix (owns the invariant at the read boundary):
   invalidate the cache by `statSync().mtimeMs` in `readPromptContent`, or
   reload `promptFiles` at the top of `before_agent_start` (one `readdir` + per-
   file `stat` per user prompt — negligible cost). Document the caveat until
   fixed.

2. **Empty exact match silently suppresses injection with no fallback** —
   **suspected / arguably by-design.** `findPromptMatch` returns the first exact
   match even when its file is empty (`model-prompts.ts:101-121`);
   `before_agent_start` then early-returns on empty content
   (`model-prompts.ts:224`) without falling through to a lower-tier match that
   *has* content. Scenario: an empty placeholder `glm.md` shadows a populated
   fuzzy candidate → nothing injected. Discoverable via the `list` empty-file
   warning (`model-prompts.ts:172-181`), so low impact. If intended, note it in
   README; otherwise skip empty files during matching.

### D. Small wins (< ~1h each)

1. Fix `README.md:38-45` directory example to match the live directory (or mark
   it explicitly illustrative).
2. Add a minimal GitHub Actions workflow: `npm ci`, `node --test`,
   `npx tsc --noEmit`.
3. Document in README that prompt-file edits need `/reload` (or running
   `/role`) to take effect — until hot-reload lands.
4. [RESOLVED 2026-07-19 during canonical-convention migration] The cleanup-task
   section was removed when `IMPLEMENTATION_PLAN.md` migrated to `docs/SPEC.md`;
   no note needed — the section is gone, not just moot.
5. Surface that `/role` reloads the file list as a documented side
   effect (it already does, `model-prompts.ts:239`) — cheap manual staleness
   escape hatch.

### Review addendum (adversarial pass — anthropic/claude-fable-5)

The initial four-release roadmap was revised after an external critique. Accepted:

- **C1 fix simplified.** The permanent memoization in `readPromptContent`
  (`model-prompts.ts:70-79`) is the bug — delete it and read per user prompt
  rather than adding mtime-invalidation machinery. This makes the fix a patch,
  not a minor. Write the failing test first (C1 is still "suspected").
- **New sub-finding: diagnostic ≠ injection.** `/model-prompt` reloads as a side
  effect, so its report can disagree with what `before_agent_start` actually
  injects. The diagnostic should read through the same path as injection.
- **C2 must be adjudicated before it is tested** — is an empty file a deliberate
  "disable for this model" override or an accidental shadow of a populated fuzzy
  match? Opposite fixes; don't test-lock the accidental behavior.
- **Killer feature is now GATED** on operator confirmation, not roadmapped. No
  concrete friction was supplied; "designed & parked" is sunk cost, not demand.
- **@base composition dropped** — templating micro-language + re-introduces C1
  one level up for little gain.
- **Test-suite gap called out:** 26/26 green while reload/accumulation semantics
  are entirely uncovered; add multi-turn + edit-mid-session + fuzzy tie-break
  tests.

Corrected (critique was speculating without code access): error handling for
deleted/unreadable files is already covered by try/catch
(`model-prompts.ts:50-67, 72-76, 86-90` → degrades to `""`, no crash); fuzzy
equal-length ties are deterministic via `localeCompare` (`model-prompts.ts:133`).
Both want a test, not a fix.

### Previous findings

_None — this is the first audit._

---
