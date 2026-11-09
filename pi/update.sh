#!/usr/bin/env bash
# Update Python dependencies and restart the backend. Does not git-pull.
set -Eeuo pipefail
PI_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VENV="$PI_DIR/.venv"
REQ="$PI_DIR/requirements.txt"
if [[ $EUID -eq 0 ]]; then USER_TO_RUN="${SUDO_USER:-}"; else USER_TO_RUN="$(id -un)"; fi
[[ -n "$USER_TO_RUN" && "$USER_TO_RUN" != root ]] || { echo "Run as the project user (optionally sudo)." >&2; exit 1; }
[[ -x "$VENV/bin/python" && -f "$REQ" ]] || { echo "Run pi/install.sh first." >&2; exit 1; }
if [[ $EUID -eq 0 ]]; then
  runuser -u "$USER_TO_RUN" -- "$VENV/bin/python" -m pip install -r "$REQ"
  systemctl restart wombot.service
  systemctl --no-pager --full status wombot.service || true
else
  "$VENV/bin/python" -m pip install -r "$REQ"
  echo "Restart backend with: sudo systemctl restart wombot"
fi
