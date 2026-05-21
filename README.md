# pi-model-prompts

Small Pi extension that appends a per-model Markdown prompt snippet to the system prompt.

It intentionally does only one thing:

> Load `~/.pi/agent/model-prompts/*.md`, match the active model, and inject the matched file.

Benchmarking, prompt research, and tuning history belong in a separate project such as `model-tuner`.

## Usage

Create prompt files:

```bash
mkdir -p ~/.pi/agent/model-prompts
$EDITOR ~/.pi/agent/model-prompts/glm-5.1.md
```

Restart Pi or run `/reload`.

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

## Prompt directory

```text
~/.pi/agent/model-prompts/
  deepseek-v4-pro.md
  deepseek-v4-pro-precision.md
  glm-5.1.md
  kimi-k2.6.md
  mimo-v2.5-pro-precision.md
```

## Commands

### `/model-prompt`

Show the current model, which prompt file matched, the match type, file size, SHA-256 (short 12-char hash), and the prompts directory.

If no match is found, displays a "no match" message with the prompts directory.

### `/model-prompt list`

List all available prompt files in `~/.pi/agent/model-prompts/` with markers for empty files and diagnostic warnings for:

- **Empty files** — files whose content is empty
- **Fuzzy overlaps** — pairs of files where one stem is a dash-bounded substring of another (e.g. `glm.md` inside `glm-5.1.md`), which could cause unexpected matching

### `/model-prompt test <provider>/<model>`

Dry-run matching against the specified provider and model without switching models. Supports two argument forms:

```text
/model-prompt test wafer/GLM-5.1
/model-prompt test wafer GLM-5.1
```

Displays the same match metadata as the base command (matched file, match type, size, SHA-256, and a content preview).

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
<!-- model-prompts: begin glm-5.1.md -->
... prompt content ...
<!-- model-prompts: end glm-5.1.md -->
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
npm test
npm run typecheck
```

## License

MIT
