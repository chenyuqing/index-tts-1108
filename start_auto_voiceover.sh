#!/usr/bin/env bash
# Helper script to kick off the Auto Voiceover dry-run backend and WebUI.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" )" && pwd)"
DEFAULT_SCRIPT="$ROOT_DIR/test_input/scripts/what is understanding-hinton-CN.md"
DEFAULT_CONFIG="$ROOT_DIR/test_input/speakers.yaml"

episode_from_path() {
  local path="$1"
  local filename
  filename="$(basename "$path")"
  echo "${filename%.*}"
}

resolve_script_path() {
  local candidate="$1"
  if [[ -n "$candidate" && -f "$candidate" ]]; then
    echo "$candidate"
    return
  fi
  local fallback
  fallback=$(find "$ROOT_DIR/test_input/scripts" -maxdepth 1 -type f -name "*.md" | head -n 1)
  if [[ -n "$fallback" ]]; then
    if [[ -n "$candidate" && ! -f "$candidate" ]]; then
      >&2 echo "[Auto Voiceover] Script $candidate missing, fallback to $fallback"
    fi
    echo "$fallback"
    return
  fi
  >&2 echo "No Markdown script found under $ROOT_DIR/test_input/scripts. Please provide a script path."
  exit 1
}

SCRIPT_PATH=$(resolve_script_path "${1:-$DEFAULT_SCRIPT}")
CONFIG_PATH="${2:-$DEFAULT_CONFIG}"
EPISODE_NAME="$(episode_from_path "$SCRIPT_PATH")"
OUT_ROOT="${3:-$ROOT_DIR/DUB/$EPISODE_NAME}"
MANIFEST_DIR="$ROOT_DIR/outputs/auto_voiceover"
MANIFEST_PATH="$MANIFEST_DIR/${EPISODE_NAME}_manifest.json"
PORT="${PORT:-7865}"
HOST="${HOST:-127.0.0.1}"

mkdir -p "$MANIFEST_DIR"

if command -v uv >/dev/null 2>&1; then
  PYTHON_CMD=(uv run python)
else
  PYTHON_CMD=(python)
fi

echo "[Auto Voiceover] Generating dry-run manifest..."
"${PYTHON_CMD[@]}" "$ROOT_DIR/tools/auto_voiceover.py" \
  --script "$SCRIPT_PATH" \
  --config "$CONFIG_PATH" \
  --out-root "$OUT_ROOT" \
  --manifest "$MANIFEST_PATH" \
  --print || {
  echo "Dry-run manifest generation failed" >&2
  exit 1
}

echo
echo "[Auto Voiceover] Dry-run manifest saved to: $MANIFEST_PATH"
echo "[Auto Voiceover] Launching WebUI on http://$HOST:$PORT"
echo "Press Ctrl+C to stop the WebUI."

exec "${PYTHON_CMD[@]}" "$ROOT_DIR/auto_voiceover_server.py" --host "$HOST" --port "$PORT"
