#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-homematic-analyzer}"
INSTALL_DIR="${INSTALL_DIR:-/opt/homematic-analyzer}"
PORT="${PORT:-3001}"
failures=0

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf '[OK] %s\n' "$label"
  else
    printf '[FEHLER] %s\n' "$label"
    failures=$((failures + 1))
  fi
}

printf 'Homematic Analyzer: Installation wird nur lesend geprüft.\n'
check "Installationsordner vorhanden" test -d "$INSTALL_DIR"
check "package.json vorhanden" test -f "$INSTALL_DIR/package.json"
check "Produktions-Build vorhanden" test -f "$INSTALL_DIR/dist/index.html"
check "Node.js verfügbar" command -v node
check "systemd-Service vorhanden" test -f "/etc/systemd/system/${SERVICE_NAME}.service"
check "systemd-Service aktiv" systemctl is-active "$SERVICE_NAME"
check "Lokale API antwortet" curl -fsS "http://127.0.0.1:${PORT}/api/health"

if [ -d "$INSTALL_DIR/.data" ]; then
  permissions="$(stat -c '%a' "$INSTALL_DIR/.data/homematic-analyzer-db.json" 2>/dev/null || true)"
  if [ -z "$permissions" ] || [ "$permissions" = "600" ]; then
    printf '[OK] Datenbank-Dateirechte sind geschützt oder noch nicht angelegt.\n'
  else
    printf '[FEHLER] Datenbank-Dateirechte sind %s statt 600.\n' "$permissions"
    failures=$((failures + 1))
  fi
fi

if compgen -G "/dev/ttyUSB*" >/dev/null || compgen -G "/dev/ttyACM*" >/dev/null || [ -d /dev/serial/by-id ]; then
  printf '[OK] Mindestens ein möglicher serieller USB-Port ist sichtbar.\n'
else
  printf '[HINWEIS] Kein serieller USB-Port sichtbar. Das ist ohne Sniffer normal.\n'
fi

if [ "$failures" -gt 0 ]; then
  printf '[FEHLER] %s Prüfung(en) fehlgeschlagen.\n' "$failures"
  exit 1
fi

printf '[OK] Installation ist betriebsbereit.\n'
