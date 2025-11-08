#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" )" && pwd)"
SERVER_PIDS=$(pgrep -f "auto_voiceover_server.py" || true)

if [[ -n "$SERVER_PIDS" ]]; then
  echo "Stopping Auto Voiceover server processes: $SERVER_PIDS"
  kill $SERVER_PIDS || true
  sleep 1
else
  echo "No running auto_voiceover_server.py processes found."
fi

IND_EXT_PIDS=$(pgrep -f "indextts" || true)
if [[ -n "$IND_EXT_PIDS" ]]; then
  echo "Killing residual IndexTTS processes: $IND_EXT_PIDS"
  kill $IND_EXT_PIDS || true
fi

PORTS=(7865 ${PORT:-})
for PORT in "${PORTS[@]}"; do
  [[ -z "$PORT" ]] && continue
  PIDS=$(lsof -ti tcp:$PORT || true)
  if [[ -n "$PIDS" ]]; then
    echo "Killing processes on port $PORT: $PIDS"
    kill $PIDS || true
  fi

done

if command -v uv >/dev/null 2>&1; then
  PYTHON_CMD=(uv run python)
else
  PYTHON_CMD=(python)
fi

"${PYTHON_CMD[@]}" - <<'PY'
try:
    import torch
    torch.cuda.empty_cache()
    torch.mps.empty_cache()
except Exception:
    pass
import gc
_ = gc.collect()
print("Caches cleared via Python.")
PY

echo "Cache cleanup complete."
