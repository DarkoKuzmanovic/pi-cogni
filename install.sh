#!/usr/bin/env bash
# Install pi-cogni extension into Pi via symlinks.
# Source stays here — edits are picked up on Pi restart.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$HOME/.pi/agent/extensions"
PROMPTS_DIR="$HOME/.pi/agent/model-prompts"

mkdir -p "$EXT_DIR" "$PROMPTS_DIR"

# Remove old model-prompts symlink if present
[ -L "$EXT_DIR/model-prompts.ts" ] && rm "$EXT_DIR/model-prompts.ts" && echo "✓ Removed old model-prompts.ts symlink"

# Symlink the extension
ln -sfn "$SCRIPT_DIR/pi-cogni.ts" "$EXT_DIR/pi-cogni.ts"
echo "✓ Symlinked pi-cogni.ts → $EXT_DIR/pi-cogni.ts"

# Symlink any coaching prompt .md files (skip README)
count=0
for md in "$SCRIPT_DIR"/*.md; do
  [ -f "$md" ] || continue
  base="$(basename "$md")"
  [[ "$base" =~ ^README ]] && continue
  ln -sfn "$md" "$PROMPTS_DIR/$base"
  echo "  ✓ $base → $PROMPTS_DIR/$base"
  ((count++)) || true
done

if [ "$count" -eq 0 ]; then
  echo "  (no coaching prompt .md files to link)"
fi

echo ""
echo "Installed pi-cogni with $count model prompt(s)."
echo "Commands: /cogni — show which prompt matches the current model"
echo "Restart Pi to pick up changes."
