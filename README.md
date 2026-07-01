# pi-model-prompts

Small Pi extension that appends a per-model Markdown prompt snippet to the system prompt.

It intentionally does only one thing:

> Load `~/.pi/agent/model-prompts/*.md`, match the active model, and inject the matched file.

As of v1.1.0 a model can carry multiple switchable **roles** (prompt variants),
selected at runtime with `/role`.

Benchmarking, prompt research, and tuning history belong in a separate project such as `model-tuner`.

## Usage

Create prompt files:

```bash
mkdir -p ~/.pi/agent/model-prompts
$EDITOR ~/.pi/agent/model-prompts/glm-5.1.md
```

Edits take effect on the next prompt — the file is read fresh each turn, so no
`/reload` is needed after editing an existing prompt file. (Creating a *new*
file is picked up when you next run a `/role` command or start a session.)

## Matching rules

First match wins:

1. **Exact provider + model:** `{provider}--{modelId}.md`
   - `wafer--glm-5.1.md` matches `wafer/GLM-5.1`
2. **Exact model:** `{modelId}.md`
   - `glm-5.1.md` matches `wafer/GLM-5.1`
3. **Fuzzy bounded segment:** filename stem appears as a dash-bounded segment after normalizing `:`, `/`, and `\` to `-`
   - `glm-5.1.md` matches `ollama/glm-5.1:cloud`
   - `glm-5.1.md` does **not** match `glm-5.10-cloud`

Fuzzy stems shorter than 3 characters are ignored. If multiple fuzzy prompts match, the longest stem wins.

## Roles (prompt variants)

A model can have more than one prompt. A file named `{stem}@{variant}.md` is a
role variant of `{stem}.md`:

```text
~/.pi/agent/model-prompts/
  glm-5.1.md              # default role
  glm-5.1@precision.md    # /role precision
  glm-5.1@worker.md       # /role worker
```

The base stem (`glm-5.1`) is what matches the model via the rules above; the
`@variant` suffix selects **which** file is injected for that model. With no
active role, the default (no-`@`) file is used.

Your selection is stored per `provider/model` in
`~/.pi/agent/model-prompts/active.json` and **persists across restarts** and
`/model` switches. If the active role has no file (e.g. you set it before
creating the file), the extension notifies you and falls back to the default
prompt until the file exists.

The subcommand keywords `list`, `test`, and `default` are reserved and cannot be
used as variant names.

## Prompt directory

```text
~/.pi/agent/model-prompts/
  active.json             # persisted role selections (managed by the extension)
  claude-opus-4-8.md
  deepseek-v4-pro.md
  glm-5.1.md
  glm-5.1@precision.md
  minimax-m3.md
```

## Commands

### `/role`

Opens an interactive picker of the current model's roles (`default` plus every
`@variant`), with the active one marked. Selecting one applies and persists it;
cancelling shows the current match details (matched file, match type, active
role, size, SHA-256, prompts directory). When a role is active it also shows in
the footer as `role: <name>`.

### `/role <name>`

Set the active role for the current model (persisted). Warns if no
`{stem}@{name}.md` file exists yet.

### `/role default`

Clear the active role for the current model — revert to the default prompt.

### `/role list`

List all prompt files grouped by base stem, with the current model's group and
active role marked, plus diagnostic warnings for:

- **Empty files** — files whose content is empty (`[empty]`)
- **Fuzzy overlaps** — pairs of files where one stem is a dash-bounded substring of another
- **Reserved names** — variant files named `list`/`test`/`default` (unreachable)

### `/role test <provider>/<model>`

Dry-run matching against the specified provider and model (honoring that model's
active role) without switching models. Supports two argument forms:

```text
/role test wafer/GLM-5.1
/role test wafer GLM-5.1
```

## Match types

When a prompt file matches, the match type tells you which rule triggered:

| Type | Description | Example |
|------|-------------|---------|
| `exact-provider-model` | Exact provider + model stem match | `wafer--glm-5.1.md` matches `wafer/GLM-5.1` |
| `exact-model` | Exact model-only stem match | `glm-5.1.md` matches `wafer/GLM-5.1` |
| `fuzzy` | Bounded fuzzy segment match | `glm-5.1.md` matches `ollama/glm-5.1:cloud` |

## Injected content markers

When a prompt is injected, it is wrapped in HTML comments so you can see the source in the system prompt:

```
<!-- model-prompts: begin glm-5.1@precision.md -->
... prompt content ...
<!-- model-prompts: end glm-5.1@precision.md -->
```

If the matched file is empty, nothing is injected.

## What this extension does not do

- no benchmarking
- no automatic prompt writing
- no prompt scoring
- no model leaderboard
- no session-log mining
- no bundled model-specific methodology

Those responsibilities should live in a separate model-tuning/research project.

## Development

```bash
npm install       # once, to get devDependencies
npm test
npm run typecheck
```

## License

MIT
