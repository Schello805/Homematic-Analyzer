#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_FILE="${UPDATE_LOG_FILE:-$ROOT_DIR/.data/update.log}"
ANALYZER_PID="${ANALYZER_PID:-}"

mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

printf '[%s] Homematic Analyzer Update gestartet\n' "$(date -Is)"
cd "$ROOT_DIR"

git config --global --add safe.directory "$ROOT_DIR" 2>/dev/null || true

printf '[INFO] Repository wird aktualisiert ...\n'
git fetch origin
current_branch="$(git rev-parse --abbrev-ref HEAD)"
git pull --ff-only origin "$current_branch"

printf '[INFO] Abhängigkeiten werden installiert ...\n'
npm ci

printf '[INFO] App wird gebaut ...\n'
npm run build

printf '[OK] Update abgeschlossen.\n'

if [ -n "$ANALYZER_PID" ] && kill -0 "$ANALYZER_PID" 2>/dev/null; then
  printf '[INFO] Analyzer-Prozess wird beendet, damit systemd/Watcher neu startet ...\n'
  sleep 1
  kill -TERM "$ANALYZER_PID" 2>/dev/null || true
fi
