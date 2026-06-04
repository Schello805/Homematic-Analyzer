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

info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
success() { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[HINWEIS]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[FEHLER]\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    fail "Bitte als root ausführen, z. B.: sudo bash install-linux.sh"
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
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git gnupg
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

sync_repository() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Vorhandene Installation wird aktualisiert: $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --all --prune
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    info "Repository wird nach $INSTALL_DIR geklont ..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
}

install_app() {
  info "Node-Abhängigkeiten werden installiert ..."
  sudo -u "$SERVICE_USER" npm --prefix "$INSTALL_DIR" ci
  info "Frontend und Analyzer werden gebaut ..."
  sudo -u "$SERVICE_USER" npm --prefix "$INSTALL_DIR" run build
  mkdir -p "$INSTALL_DIR/.data"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.data"
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
  detect_os
  install_base_packages
  install_node
  ensure_service_user
  sync_repository
  install_app
  write_service
  show_result
}

main "$@"
