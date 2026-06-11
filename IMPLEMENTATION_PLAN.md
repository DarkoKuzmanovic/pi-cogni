# TODO — Per-model prompt **variants** (Approach A)

**Status:** designed, parked 2026-05-22. Pick up later.
**Why:** `mimo-v2.5-pro-precision.md` is great for orchestrator mode but I sometimes want a regular `mimo-v2.5-pro` worker role or a different role entirely. Currently I'd have to rename files, and the precision file is actually inert today (fuzzy matcher won't match a longer stem against a shorter model id).

---

## The problem in one sentence

Today one model = one `.md` file (filename matching). I want one model = many `.md` variants, switchable at runtime via a TUI picker, with the choice persisted.

## Picked direction: Approach A — filename suffix + slash-command picker

Rejected: stackable layers (overkill), JSON registry (two sources of truth), full custom overlay TUI (start simple, escalate only if needed).

### Naming convention

```
{model}@{variant}.md          variant-named prompt
{model}.md                    default (no variant) — same as today
```

Examples:

```
mimo-v2.5-pro.md              ← default
mimo-v2.5-pro@precision.md    ← variant "precision"
mimo-v2.5-pro@worker.md       ← variant "worker"
glm-5.1.md
glm-5.1@precision.md
```

Provider-scoped names (`xiaomi--mimo-v2.5-pro@precision.md`) follow the same `@` convention as today's `{provider}--{model}.md` prefix. Matching precedence stays:

1. exact provider+model
2. exact model
3. fuzzy bounded segment

…with a **variant filter** applied at each tier. If the active variant for the current model is `precision`, we look for `…@precision.md` first; if absent, fall back to `…@default` (no `@` suffix) and `notify` the user.

### Slash commands

| Command | Behavior |
|---------|----------|
| `/role` | Open `ctx.ui.select` listing variants available for current model, current selection highlighted. Picking one persists. |
| `/role default` | Reset to no-variant for current model. |
| `/role <name>` | Set active variant to `<name>` for current model, even if no file exists yet (will warn at `before_agent_start`). |
| `/role list` | Show all variants across all models with the active one marked. |

Keep `/model-prompt` as alias or rename it `/role` outright — the new name is shorter and the concept changed. **Decision pending: keep both or only `/role`?**

### State file

`~/.pi/agent/model-prompts/active.json`:

```json
{
  "xiaomi/mimo-v2.5-pro": "precision",
  "wafer/GLM-5.1": "default"
}
```

Key = `{provider}/{model}` (canonical). Value = variant name or `"default"`. Missing key = `"default"`.

### Status footer

```typescript
ctx.ui.setStatus("model-prompts", `role: ${activeVariant ?? "default"}`);
```

Set on `session_start`, `before_agent_start`, and after `/role` switches. So I always see what's active without typing a command.

### Match algorithm sketch

```typescript
function findVariantMatch(
  provider: string,
  modelId: string,
  variant: string | undefined,
  files: PromptFile[],
): PromptMatch | undefined {
  const v = variant && variant !== "default" ? `@${variant}` : "";
  const targets = [
    normalize(`${provider}--${modelId}${v}`),
    normalize(`${modelId}${v}`),
  ];
  // Fuzzy tier: stem must end with @${variant} (or have no @ when default)
  // and the @-prefix must satisfy the bounded-segment rule.
  // Reuse findPromptMatch logic but parameterize the "stem suffix" check.
}
```

The trick: parse `@variant` out of every prompt-file stem at load time, so we have `{baseStem, variant}` pairs to filter against the requested variant.

### File parsing changes in `loadPromptFiles()`

Add to `PromptFile`:

```typescript
export interface PromptFile {
  stem: string;          // existing — full stem including @variant
  baseStem: string;      // NEW — stem without @variant suffix
  variant: string | null; // NEW — null if no @ in filename
  fullPath: string;
  content?: string;
}
```

Splitting rule: rightmost `@` only (so `email@example.com.md` wouldn't break anything weird, but that's a non-case anyway).

---

## Open decisions (answer before implementing)

These four were raised in the brainstorm and not yet locked:

1. **Persistence scope** — persist `active.json` across Pi restarts (recommended) or session-only?
2. **Cross-model state carryover** — switching `/model` mid-session should keep per-model variant state (recommended). State is keyed by `provider/model`, so this is automatic with persistent storage.
3. **`/role` vs `/model-prompt` command name** — rename to `/role`, keep both as aliases, or keep `/model-prompt` only? I lean toward keep `/model-prompt` as the canonical name (it's accurate, doesn't conflate with `subagent` roles) and add `/role` as a shorter alias.
4. **Fallback chain when active variant has no file** — silently fall back to default, or notify and fall back, or notify and inject nothing?

---

## Acceptance criteria

- `~/.pi/agent/model-prompts/mimo-v2.5-pro.md` + `…@precision.md` + `…@worker.md` all exist.
- `/role` opens a picker showing `default`, `precision`, `worker` with the current pick highlighted.
- Picking `precision` persists to `active.json` and the next `before_agent_start` injects `…@precision.md`.
- Status footer shows `role: precision`.
- `/role default` clears the entry from `active.json` and `before_agent_start` injects `mimo-v2.5-pro.md`.
- `/model-prompt list` (or `/role list`) shows all variants across all models with the active one marked.
- Existing single-file workflow still works for models that have no `@variant` files.

---

## Test plan (write these before implementation)

1. `findVariantMatch` unit tests for each tier × variant combo (default, named, missing-file fallback).
2. `loadPromptFiles` parses `@variant` correctly; files without `@` get `variant: null`.
3. `active.json` round-trip: write, restart Pi, state preserved.
4. Fuzzy overlap warnings still fire for `@variant`-suffixed stems.
5. Empty-file warning still fires.

---

## Implementation skeleton

The current extension is ~385 lines. Estimated delta: +150 lines for the variant machinery, +50 lines of tests. Keep it inside `model-prompts.ts` — no new files needed.

Touch points:
- `PromptFile` interface: add `baseStem`, `variant`
- `loadPromptFiles()`: parse `@variant` out of stems
- `findPromptMatch()` → `findVariantMatch()`: accept variant param, filter
- `pi.on("before_agent_start")`: load `active.json`, pass current variant
- `pi.registerCommand("model-prompt")`: extend with `set <variant>`, picker on no-arg
- New helper: `loadActiveVariants() / saveActiveVariants()` for `active.json` I/O
- New: `ctx.ui.setStatus("model-prompts", ...)` calls

### Pi API references (verified 2026-05-22)

- `ctx.ui.select(title, options[])` — single-pick picker, returns `string | undefined`. See `docs/extensions.md` §Dialogs (around line 2118).
- `ctx.ui.setStatus(id, message)` — footer status (line 166 of docs).
- `pi.registerCommand(name, { description, handler })` — slash command. Already used.
- `pi.appendEntry(...)` — session-persistent state, not needed here (we use plain `active.json` for cross-session persistence).
- Hook `before_agent_start` — already used; gets `event.systemPrompt` and `ctx.model`.

---

## When picking this back up

1. Read `~/.pi/agent/extensions/model-prompts/model-prompts.ts` (current implementation).
2. Re-read this file.
3. Lock the four open decisions above (5 minutes).
4. Read `~/.nvm/versions/node/v24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` §Dialogs and §Commands to verify the API shapes haven't drifted.
5. TDD: write the `findVariantMatch` unit tests first against the current test file (`model-prompts.test.ts`), watch them fail, then implement.
6. Smoke-test by creating `mimo-v2.5-pro@precision.md` as a copy of the current `mimo-v2.5-pro-precision.md` (note: `@` not `-`), and verifying `/role precision` injects it.

---

## Cleanup task during implementation

The current `mimo-v2.5-pro-precision.md` filename never actually matches `xiaomi/mimo-v2.5-pro` under the fuzzy rule (stem is longer than the model id). When migrating, rename it to `mimo-v2.5-pro@precision.md` so it actually engages. Same audit pass for any other `*-precision.md` / `*-worker.md` files in the directory.
