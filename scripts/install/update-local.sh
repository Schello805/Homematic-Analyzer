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

if [ -d "$ROOT_DIR/.data" ]; then
  backup_file="$ROOT_DIR/.data/pre-update-$(date +%Y%m%d-%H%M%S).tar.gz"
  temporary_backup="${TMPDIR:-/tmp}/homematic-analyzer-pre-update-$$.tar.gz"
  printf '[INFO] Lokale Konfiguration wird vor dem Update gesichert: %s\n' "$backup_file"
  tar --exclude='.data/pre-update-*.tar.gz' -czf "$temporary_backup" -C "$ROOT_DIR" .data
  mv "$temporary_backup" "$backup_file"
  chmod 600 "$backup_file"
  ls -1t "$ROOT_DIR"/.data/pre-update-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
fi

printf '[INFO] Repository wird aktualisiert ...\n'
previous_head="$(git rev-parse HEAD 2>/dev/null || true)"
git fetch origin
current_branch="$(git rev-parse --abbrev-ref HEAD)"
git pull --ff-only origin "$current_branch"
current_head="$(git rev-parse HEAD 2>/dev/null || true)"

dependencies_changed="no"
if [ ! -d "$ROOT_DIR/node_modules" ] || [ ! -x "$ROOT_DIR/node_modules/.bin/tsc" ]; then
  dependencies_changed="yes"
elif [ -n "$previous_head" ] && [ -n "$current_head" ] && [ "$previous_head" != "$current_head" ]; then
  if git diff --name-only "$previous_head" "$current_head" -- package.json package-lock.json | grep -q .; then
    dependencies_changed="yes"
  fi
fi

if [ "$dependencies_changed" = "yes" ]; then
  printf '[INFO] Abhängigkeiten inklusive Build-Werkzeuge werden installiert ...\n'
  npm ci --include=dev
else
  printf '[INFO] Abhängigkeiten unverändert, npm ci wird übersprungen.\n'
fi

if ! [ -x ./node_modules/.bin/tsc ]; then
  printf '[ERROR] TypeScript Compiler wurde nicht gefunden: ./node_modules/.bin/tsc\n'
  printf '[HINWEIS] Prüfe, ob npm mit omit=dev oder NODE_ENV=production läuft.\n'
  exit 1
fi

printf '[INFO] App wird gebaut ...\n'
npm run build

printf '[OK] Update abgeschlossen.\n'

if [ -n "$ANALYZER_PID" ] && kill -0 "$ANALYZER_PID" 2>/dev/null; then
  printf '[INFO] Analyzer-Prozess wird beendet, damit systemd/Watcher neu startet ...\n'
  sleep 1
  kill -TERM "$ANALYZER_PID" 2>/dev/null || true
fi
