#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-homematic-analyzer}"
INSTALL_DIR="${INSTALL_DIR:-/opt/homematic-analyzer}"
SERVICE_USER="${SERVICE_USER:-homematic-analyzer}"
PURGE_DATA=false

if [ "${1:-}" = "--purge-data" ]; then
  PURGE_DATA=true
fi

if [ "$(id -u)" -ne 0 ]; then
  printf '[FEHLER] Bitte mit sudo ausführen.\n'
  exit 1
fi

printf '[INFO] Homematic Analyzer wird gestoppt und aus systemd entfernt.\n'
systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload

if [ "$PURGE_DATA" = true ]; then
  printf '[WARNUNG] Installationsordner inklusive Konfiguration und Messdaten wird gelöscht.\n'
  rm -rf "$INSTALL_DIR"
  userdel "$SERVICE_USER" 2>/dev/null || true
else
  printf '[OK] App wurde deaktiviert. Daten bleiben unter %s erhalten.\n' "$INSTALL_DIR"
  printf '[HINWEIS] Vollständig löschen: sudo bash %s/scripts/install/uninstall-linux.sh --purge-data\n' "$INSTALL_DIR"
fi

printf '[OK] Deinstallation abgeschlossen.\n'
