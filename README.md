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

Check the active match:

```text
/model-prompt
```

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
