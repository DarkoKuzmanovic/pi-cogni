# Spec — Per-model prompt variants (Approach A)

**Status:** Shipped in v1.1.0 (2026-07-02). Retained as design rationale.
Locked decisions live in [`DECISIONS.md`](../DECISIONS.md). Milestone ledger lives in [`../ROADMAP.md`](../ROADMAP.md).

---

## The problem in one sentence

Today one model = one `.md` file (filename matching). I want one model = many
`.md` variants, switchable at runtime via a TUI picker, with the choice
persisted.

## Picked direction: Approach A — filename suffix + slash-command picker

Rejected: stackable layers (overkill), JSON registry (two sources of truth),
full custom overlay TUI (start simple, escalate only if needed).

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

Provider-scoped names (`xiaomi--mimo-v2.5-pro@precision.md`) follow the same
`@` convention as today's `{provider}--{model}.md` prefix. Matching precedence
stays:

1. exact provider+model
2. exact model
3. fuzzy bounded segment

…with a **variant filter** applied at each tier. If the active variant for the
current model is `precision`, we look for `…@precision.md` first; if absent,
fall back to `…@default` (no `@` suffix) and `notify` the user.

### Slash commands

| Command | Behavior |
|---------|----------|
| `/role` | Open `ctx.ui.select` listing variants available for current model, current selection highlighted. Picking one persists. |
| `/role default` | Reset to no-variant for current model. |
| `/role <name>` | Set active variant to `<name>` for current model, even if no file exists yet (will warn at `before_agent_start`). |
| `/role list` | Show all variants across all models with the active one marked. |

The original `/model-prompt` diagnostic was renamed to `/role` outright — see
DECISIONS.md D3 for the locking decision and rationale.

### State file

`~/.pi/agent/model-prompts/active.json`:

```json
{
  "xiaomi/mimo-v2.5-pro": "precision",
  "wafer/GLM-5.1": "default"
}
```

Key = `{provider}/{model}` (canonical). Value = variant name or `"default"`.
Missing key = `"default"`.

### Status footer

```typescript
ctx.ui.setStatus("model-prompts", `role: ${activeVariant ?? "default"}`);
```

Set on `session_start`, `before_agent_start`, and after `/role` switches. So I
always see what's active without typing a command.

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

The trick: parse `@variant` out of every prompt-file stem at load time, so we
have `{baseStem, variant}` pairs to filter against the requested variant.

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

Splitting rule: rightmost `@` only (so `email@example.com.md` wouldn't break
anything weird, but that's a non-case anyway).

---

## Resolved `/role` grammar

| Command | Behavior |
|---------|----------|
| `/role` | Show current model, matched file, match type, and active variant. |
| `/role list` | List variants across all models, active one marked. |
| `/role test <p>/<m>` | Dry-run match (+ variant) without switching. |
| `/role default` | Clear the active variant for the current model. |
| `/role <name>` | Set active variant `<name>` for the current model. |

---

## Acceptance criteria (all shipped in v1.1.0)

- `~/.pi/agent/model-prompts/mimo-v2.5-pro.md` + `…@precision.md` + `…@worker.md` all exist.
- `/role` opens a picker showing `default`, `precision`, `worker` with the current pick highlighted.
- Picking `precision` persists to `active.json` and the next `before_agent_start` injects `…@precision.md`.
- Status footer shows `role: precision`.
- `/role default` clears the entry from `active.json` and `before_agent_start` injects `mimo-v2.5-pro.md`.
- `/role list` shows all variants across all models with the active one marked.
- Existing single-file workflow still works for models that have no `@variant` files.

---

## Test plan (shipped — see `model-prompts.test.ts`)

1. `findVariantMatch` unit tests for each tier × variant combo (default, named, missing-file fallback).
2. `loadPromptFiles` parses `@variant` correctly; files without `@` get `variant: null`.
3. `active.json` round-trip: write, restart Pi, state preserved.
4. Fuzzy overlap warnings still fire for `@variant`-suffixed stems.
5. Empty-file warning still fires.

---

## Implementation skeleton

The v1.1.0 implementation is in `model-prompts.ts`. Touch points actually shipped:

- `PromptFile` interface: added `baseStem`, `variant`
- `loadPromptFiles()`: parses `@variant` out of stems
- `findPromptMatch()` → `findVariantMatch()`: accepts variant param, filters
- `pi.on("before_agent_start")`: loads `active.json`, passes current variant
- `pi.registerCommand("model-prompt")` → `pi.registerCommand("role")`: subcommand grammar
- New helper: `loadActiveVariants() / saveActiveVariants()` for `active.json` I/O
- New: `ctx.ui.setStatus("model-prompts", ...)` calls

### Pi API references (verified 2026-05-22)

- `ctx.ui.select(title, options[])` — single-pick picker, returns `string | undefined`. See `docs/extensions.md` §Dialogs (around line 2118).
- `ctx.ui.setStatus(id, message)` — footer status (line 166 of docs).
- `pi.registerCommand(name, { description, handler })` — slash command. Already used.
- `pi.appendEntry(...)` — session-persistent state, not needed here (we use plain `active.json` for cross-session persistence).
- Hook `before_agent_start` — already used; gets `event.systemPrompt` and `ctx.model`.
