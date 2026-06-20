#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="homematic-analyzer"
SERVICE_NAME="homematic-analyzer"
REPO_URL="${REPO_URL:-https://github.com/Schello805/Homematic-Analyzer.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/homematic-analyzer}"
SERVICE_USER="${SERVICE_USER:-homematic-analyzer}"
PORT="${PORT:-3001}"
NODE_MAJOR="${NODE_MAJOR:-20}"
SETUP_DEFAULTS_WRITTEN=0
EXISTING_INSTALL=0

info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
success() { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[HINWEIS]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[FEHLER]\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    fail "Bitte als root ausführen, z. B.: sudo bash install-linux.sh"
  fi
}

detect_existing_installation() {
  if [ "${FORCE_FIRST_SETUP:-0}" = "1" ]; then
    EXISTING_INSTALL=0
    warn "FORCE_FIRST_SETUP=1 gesetzt: Erstsetup-Fragen werden erzwungen."
    return
  fi

  if [ -d "$INSTALL_DIR/.git" ] \
    || [ -f "$INSTALL_DIR/package.json" ] \
    || [ -f "$INSTALL_DIR/.data/homematic-analyzer-db.json" ] \
    || [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
    EXISTING_INSTALL=1
    info "Bestehende Installation erkannt: Setup-Fragen werden bei diesem Lauf übersprungen."
  fi
}

detect_os() {
  if [ ! -f /etc/os-release ]; then
    fail "Dieses Script unterstützt Debian/Ubuntu Systeme. /etc/os-release wurde nicht gefunden."
  fi
  . /etc/os-release
  case "${ID:-}" in
    debian|ubuntu|raspbian) ;;
    *)
      case "${ID_LIKE:-}" in
        *debian*|*ubuntu*) ;;
        *) fail "Nicht unterstütztes System: ${PRETTY_NAME:-unbekannt}. Bitte Debian/Ubuntu verwenden." ;;
      esac
      ;;
  esac
  info "System erkannt: ${PRETTY_NAME:-Debian/Ubuntu}"
}

run_apt_update_once() {
  if [ "${APT_UPDATED:-0}" != "1" ]; then
    info "Paketlisten werden aktualisiert ..."
    apt-get update -y
    APT_UPDATED=1
  fi
}

install_base_packages() {
  run_apt_update_once
  info "Basis-Pakete werden installiert ..."
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git gnupg util-linux usbutils
}

node_major_version() {
  if command -v node >/dev/null 2>&1; then
    node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

install_node() {
  current_major="$(node_major_version)"
  if [ "$current_major" -ge "$NODE_MAJOR" ]; then
    success "Node.js $(node -v) ist bereits installiert."
    return
  fi

  warn "Node.js ${NODE_MAJOR} wird installiert oder aktualisiert."
  run_apt_update_once
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  success "Node.js $(node -v) installiert."
}

ensure_service_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    success "Systembenutzer $SERVICE_USER existiert bereits."
  else
    info "Systembenutzer $SERVICE_USER wird angelegt ..."
    useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

run_as_service_user() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$SERVICE_USER" -- "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u "$SERVICE_USER" "$@"
  else
    fail "Weder runuser noch sudo gefunden. Kann Befehle nicht als $SERVICE_USER ausführen."
  fi
}

sync_repository() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    EXISTING_INSTALL=1
    info "Vorhandene Installation wird aktualisiert: $INSTALL_DIR"
    git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
    git -C "$INSTALL_DIR" fetch --all --prune
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    info "Repository wird nach $INSTALL_DIR geklont ..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
  git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
}

install_app() {
  info "Node-Abhängigkeiten werden installiert ..."
  run_as_service_user npm --prefix "$INSTALL_DIR" ci
  info "Frontend und Analyzer werden gebaut ..."
  run_as_service_user npm --prefix "$INSTALL_DIR" run build
  mkdir -p "$INSTALL_DIR/.data"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.data"
  chmod 700 "$INSTALL_DIR/.data"
  find "$INSTALL_DIR/.data" -maxdepth 1 -type f -exec chmod 600 {} \; 2>/dev/null || true
}

has_tty() {
  [ -r /dev/tty ] && [ -w /dev/tty ]
}

ask_text() {
  local prompt="$1"
  local default_value="${2:-}"
  local answer

  if ! has_tty || [ "${NONINTERACTIVE:-0}" = "1" ]; then
    printf '%s' "$default_value"
    return
  fi

  if [ -n "$default_value" ]; then
    printf '%s [%s]: ' "$prompt" "$default_value" > /dev/tty
  else
    printf '%s: ' "$prompt" > /dev/tty
  fi

  IFS= read -r answer < /dev/tty || answer=""
  printf '%s' "${answer:-$default_value}"
}

ask_yes_no() {
  local prompt="$1"
  local default_value="${2:-n}"
  local answer

  if ! has_tty || [ "${NONINTERACTIVE:-0}" = "1" ]; then
    [ "$default_value" = "j" ] || [ "$default_value" = "y" ]
    return
  fi

  printf '%s [%s]: ' "$prompt" "$default_value" > /dev/tty
  IFS= read -r answer < /dev/tty || answer=""
  answer="${answer:-$default_value}"

  case "$answer" in
    j|J|y|Y|ja|Ja|yes|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

scan_usb_ports() {
  {
    find /dev/serial/by-id -maxdepth 1 -type l 2>/dev/null
    find /dev -maxdepth 1 \( -name 'ttyUSB*' -o -name 'ttyACM*' \) 2>/dev/null
  } | awk 'NF && !seen[$0]++'
}

choose_usb_port() {
  local ports=()
  local index=1
  local choice

  while IFS= read -r port; do
    ports+=("$port")
  done < <(scan_usb_ports)

  if [ "${#ports[@]}" -eq 0 ]; then
    printf '\033[1;33m[HINWEIS]\033[0m Kein USB-Seriell-Port gefunden. In Proxmox LXC muss der USB-Stick vorher in den Container durchgereicht werden.\n' > /dev/tty
    ask_text "Sniffer-Port manuell eintragen oder leer lassen" ""
    return
  fi

  printf '\033[1;34m[INFO]\033[0m Gefundene USB-/Seriell-Ports:\n' > /dev/tty
  for port in "${ports[@]}"; do
    printf '  %s) %s\n' "$index" "$port" > /dev/tty
    index=$((index + 1))
  done
  printf '  0) Kein Sniffer / später eintragen\n' > /dev/tty

  choice="$(ask_text "Welcher Port ist der AskSin Analyzer XS Sniffer?" "0")"
  if [ "$choice" = "0" ] || [ -z "$choice" ]; then
    printf ''
    return
  fi

  if printf '%s' "$choice" | grep -Eq '^[0-9]+$' && [ "$choice" -ge 1 ] && [ "$choice" -le "${#ports[@]}" ]; then
    printf '%s' "${ports[$((choice - 1))]}"
  else
    printf '%s' "$choice"
  fi
}

grant_serial_permissions() {
  local sniffer_port="$1"

  [ -n "$sniffer_port" ] || return

  if getent group dialout >/dev/null 2>&1; then
    usermod -aG dialout "$SERVICE_USER" || true
    success "$SERVICE_USER wurde zur Gruppe dialout hinzugefügt."
  fi

  if [ -e "$sniffer_port" ]; then
    chgrp dialout "$sniffer_port" 2>/dev/null || true
    chmod g+rw "$sniffer_port" 2>/dev/null || true
  fi
}

write_setup_defaults() {
  local ccu_host="$1"
  local ccu_user="$2"
  local xml_api_token="$3"
  local sniffer_port="$4"
  local db_file="$INSTALL_DIR/.data/homematic-analyzer-db.json"
  local temp_file="${db_file}.tmp"

  mkdir -p "$INSTALL_DIR/.data"

  CCU_HOST="$ccu_host" \
  CCU_USER="$ccu_user" \
  XML_API_TOKEN="$xml_api_token" \
  SNIFFER_PORT="$sniffer_port" \
  DB_FILE="$db_file" \
  TEMP_FILE="$temp_file" \
  node <<'NODE'
const fs = require("node:fs");
const dbFile = process.env.DB_FILE;
const tempFile = process.env.TEMP_FILE;
let db = { version: 1 };

try {
  db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
} catch {
}

const setupDefaults = {};
if (process.env.CCU_HOST) setupDefaults.ccuHost = process.env.CCU_HOST;
if (process.env.CCU_USER) setupDefaults.ccuUser = process.env.CCU_USER;
if (process.env.XML_API_TOKEN) setupDefaults.xmlApiToken = process.env.XML_API_TOKEN;
if (process.env.SNIFFER_PORT) setupDefaults.snifferPort = process.env.SNIFFER_PORT;

db.version = 1;
db.updatedAt = new Date().toISOString();
db.setupDefaults = setupDefaults;

fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
fs.renameSync(tempFile, dbFile);
NODE

  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.data"
  SETUP_DEFAULTS_WRITTEN=1
}

configure_initial_setup() {
  local ccu_host=""
  local ccu_user=""
  local xml_api_token=""
  local sniffer_port=""

  if [ "$EXISTING_INSTALL" = "1" ]; then
    info "Update erkannt: Erstsetup-Fragen werden übersprungen."
    return
  fi

  if ! has_tty || [ "${NONINTERACTIVE:-0}" = "1" ]; then
    warn "Kein interaktives Terminal erkannt. Setup-Vorgaben werden übersprungen."
    return
  fi

  printf '\n' > /dev/tty
  info "Optionales Erstsetup: Du kannst alles leer lassen und später in der Web-App eintragen."

  if ask_yes_no "CCU-IP/Host jetzt eintragen?" "j"; then
    ccu_host="$(ask_text "CCU-IP oder Host" "")"
    ccu_user="$(ask_text "CCU-Benutzer" "Admin")"
    xml_api_token="$(ask_text "XML-API Token-ID / sid (ohne @, optional)" "")"
  fi

  if ask_yes_no "USB-Ports nach AskSin Analyzer XS Sniffer scannen?" "j"; then
    sniffer_port="$(choose_usb_port)"
    grant_serial_permissions "$sniffer_port"
  fi

  if [ -n "$ccu_host" ] || [ -n "$ccu_user" ] || [ -n "$xml_api_token" ] || [ -n "$sniffer_port" ]; then
    write_setup_defaults "$ccu_host" "$ccu_user" "$xml_api_token" "$sniffer_port"
    success "Setup-Vorgaben wurden in der lokalen Analyzer-Datenbank gespeichert."
  else
    warn "Keine Setup-Vorgaben gespeichert. Du kannst alles später in der Web-App eintragen."
  fi
}

write_service() {
  info "systemd-Service wird eingerichtet ..."
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=Homematic Analyzer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
}

wait_for_analyzer() {
  local health_url="http://127.0.0.1:${PORT}/api/health"
  local attempt=1

  info "Warte kurz, bis der Analyzer erreichbar ist ..."
  while [ "$attempt" -le 20 ]; do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      success "Analyzer API ist erreichbar."
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  warn "Analyzer API war noch nicht erreichbar. Collector kann später in der Web-App ausgeführt werden."
  return 1
}

configure_collector_delivery() {
  local choice
  local mode=""
  local interval="daily"
  local script_url

  if [ "$EXISTING_INSTALL" = "1" ]; then
    info "Update erkannt: Collector-Einrichtung bleibt unverändert."
    return
  fi

  if ! has_tty || [ "${NONINTERACTIVE:-0}" = "1" ]; then
    warn "Kein interaktives Terminal erkannt. System-Snapshot wird nicht automatisch eingerichtet."
    return
  fi

  printf '\n' > /dev/tty
  info "Optionaler System-Snapshot: CPU, RAM, Temperatur, Speicher, Backups, Logs und Verbindungen."
  printf '  0) Gar nicht, später in der Web-App einrichten\n' > /dev/tty
  printf '  1) Einmalig jetzt an den Analyzer senden\n' > /dev/tty
  printf '  2) Regelmäßig täglich nachts senden (empfohlen)\n' > /dev/tty
  printf '  3) Regelmäßig minütlich senden (für CPU/RAM-Verlauf)\n' > /dev/tty

  choice="$(ask_text "Wie sollen Systemdaten an den Analyzer übertragen werden?" "2")"

  case "$choice" in
    0|"")
      warn "System-Snapshot übersprungen."
      return
      ;;
    1)
      mode="once"
      interval="daily"
      ;;
    2)
      mode="install"
      interval="daily"
      ;;
    3)
      mode="install"
      interval="minute"
      ;;
    *)
      warn "Unbekannte Auswahl. System-Snapshot wird übersprungen."
      return
      ;;
  esac

  wait_for_analyzer || return

  script_url="http://127.0.0.1:${PORT}/api/collector/script?url=http%3A%2F%2F127.0.0.1%3A${PORT}&mode=${mode}&interval=${interval}"
  info "Collector-Script wird ausgeführt ..."
  if curl -fsSL "$script_url" | sh; then
    success "System-Snapshot wurde verarbeitet."
  else
    warn "System-Snapshot konnte nicht ausgeführt werden. Du kannst ihn später in der Web-App erneut kopieren."
  fi
}

show_result() {
  local ip_address
  ip_address="$(hostname -I 2>/dev/null | awk '{print $1}')"
  success "Homematic Analyzer wurde installiert und gestartet."
  printf '\n'
  info "Status prüfen: sudo systemctl status ${SERVICE_NAME}"
  info "Logs anzeigen: sudo journalctl -u ${SERVICE_NAME} -f"
  info "Update erneut ausführen: sudo bash ${INSTALL_DIR}/scripts/install/install-linux.sh"
  printf '\n'
  if [ -n "$ip_address" ]; then
    success "Web-App: http://${ip_address}:${PORT}"
  else
    success "Web-App: http://SERVER-IP:${PORT}"
  fi
  warn "Für Zugriff von außen bitte VPN verwenden, keine Portweiterleitung zur CCU."
}

main() {
  require_root
  detect_existing_installation
  detect_os
  install_base_packages
  install_node
  ensure_service_user
  sync_repository
  install_app
  configure_initial_setup
  write_service
  configure_collector_delivery
  show_result
}

main "$@"
