#!/bin/sh
set -eu
umask 077

ANALYZER_URL="${ANALYZER_URL:-__ANALYZER_URL__}"
ANALYZER_TOKEN="${ANALYZER_TOKEN:-__ANALYZER_TOKEN__}"
COLLECTOR_MODE="${COLLECTOR_MODE:-__COLLECTOR_MODE__}"
COLLECTOR_INTERVAL="${COLLECTOR_INTERVAL:-__COLLECTOR_INTERVAL__}"
COLLECTOR_SCRIPT_URL="${COLLECTOR_SCRIPT_URL:-__COLLECTOR_SCRIPT_URL__}"
ENDPOINT="$ANALYZER_URL/api/collector"
HOSTNAME_VALUE="$(hostname 2>/dev/null || echo unknown)"
COLLECTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"
TMP_DIR="${TMPDIR:-/tmp}"
CRON_MARKER="Homematic Analyzer system snapshot"

make_tmp_file() {
  mktemp "$TMP_DIR/homematic-analyzer-$1.XXXXXX" 2>/dev/null || echo "$TMP_DIR/homematic-analyzer-$1.$$.tmp"
}

TMP_FILE="$(make_tmp_file payload)"
RESPONSE_FILE="$(make_tmp_file response)"
: > "$TMP_FILE"
: > "$RESPONSE_FILE"

cleanup() {
  rm -f "$TMP_FILE" "$RESPONSE_FILE"
}

trap cleanup EXIT INT TERM

install_cron_line() {
  interval="$1"
  case "$interval" in
    hourly)
      cron_time="17 * * * *"
      interval_text="stündlich"
      ;;
    daily|*)
      cron_time="23 3 * * *"
      interval_text="täglich um 03:23 Uhr"
      ;;
  esac

  cron_command="$cron_time curl -fsSL \"$COLLECTOR_SCRIPT_URL\" | sh >/tmp/homematic-analyzer-collector.log 2>&1 # $CRON_MARKER"
  temp_cron="$(make_tmp_file cron)"
  current_cron="$(make_tmp_file current-cron)"
  : > "$temp_cron"
  : > "$current_cron"

  if command -v crontab >/dev/null 2>&1; then
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" > "$current_cron" || true
    cat "$current_cron" > "$temp_cron"
    printf '%s\n' "$cron_command" >> "$temp_cron"
    crontab "$temp_cron"
  else
    cron_file="/etc/crontabs/root"
    [ -d "/etc/crontabs" ] || mkdir -p "/etc/crontabs" 2>/dev/null || true
    [ -f "$cron_file" ] || : > "$cron_file"
    grep -v "$CRON_MARKER" "$cron_file" > "$temp_cron" 2>/dev/null || true
    printf '%s\n' "$cron_command" >> "$temp_cron"
    cat "$temp_cron" > "$cron_file"
  fi

  killall -HUP crond 2>/dev/null || true
  /etc/init.d/S90crond restart 2>/dev/null || true
  echo "Homematic Analyzer: Regelmäßige Übertragung eingerichtet ($interval_text)."
  echo "Homematic Analyzer: Logdatei des Cronjobs: /tmp/homematic-analyzer-collector.log"
}

remove_cron_line() {
  temp_cron="$(make_tmp_file cron-remove)"
  : > "$temp_cron"

  if command -v crontab >/dev/null 2>&1; then
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" > "$temp_cron" || true
    crontab "$temp_cron"
  elif [ -f "/etc/crontabs/root" ]; then
    grep -v "$CRON_MARKER" "/etc/crontabs/root" > "$temp_cron" 2>/dev/null || true
    cat "$temp_cron" > "/etc/crontabs/root"
  fi

  killall -HUP crond 2>/dev/null || true
  /etc/init.d/S90crond restart 2>/dev/null || true
  echo "Homematic Analyzer: Regelmäßige Übertragung entfernt."
}

if [ "$COLLECTOR_MODE" = "install" ]; then
  install_cron_line "$COLLECTOR_INTERVAL"
  echo "Homematic Analyzer: Sende zusätzlich direkt einen aktuellen Snapshot."
fi

if [ "$COLLECTOR_MODE" = "uninstall" ]; then
  remove_cron_line
  exit 0
fi

echo "Homematic Analyzer: System-Snapshot wird vorbereitet."
echo "Homematic Analyzer: Ziel $ENDPOINT"

json_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g'
}

value_or_empty() {
  sh -c "$1" 2>/dev/null | head -n 1 | json_escape || true
}

UPTIME_VALUE="$(value_or_empty "uptime")"
MEMORY_VALUE="$(value_or_empty "free -m")"
DISK_VALUE="$(value_or_empty "df -h /")"
TEMP_VALUE="$(value_or_empty "cat /sys/class/thermal/thermal_zone0/temp")"
CPU_VALUE="$(value_or_empty "top -bn1 | head -n 5")"
BACKUP_COUNT="$(find /usr/local/backup /media/usb0/backup /backup -type f 2>/dev/null | wc -l | tr -d ' ')"

echo "Homematic Analyzer: Systemwerte gesammelt."

LOG_LINES="$(
  {
    grep -iE "error|warn|unreach|lowbat|duty|carrier|hmip|rfd|rega|multimacd" /var/log/messages 2>/dev/null
    grep -iE "error|warn|unreach|lowbat|duty|carrier|hmip|rfd|rega|multimacd" /var/log/syslog 2>/dev/null
    journalctl -n 80 --no-pager 2>/dev/null | grep -iE "error|warn|unreach|lowbat|duty|carrier|hmip|rfd|rega|multimacd" 2>/dev/null
  } | tail -n 25 | json_escape
)"

CONNECTION_LINES="$(
  {
    ss -Htanp 2>/dev/null
    netstat -tnp 2>/dev/null
    netstat -tn 2>/dev/null
  } | grep -E ":(80|443|8181|2001|2010|9292|42001|42010|8700|8701)[[:space:]]" 2>/dev/null | head -n 80 | json_escape
)"

{
  printf '{\n'
  printf '  "token": "%s",\n' "$(printf '%s' "$ANALYZER_TOKEN" | json_escape)"
  printf '  "host": "%s",\n' "$(printf '%s' "$HOSTNAME_VALUE" | json_escape)"
  printf '  "collectedAt": "%s",\n' "$(printf '%s' "$COLLECTED_AT" | json_escape)"
  printf '  "system": {\n'
  printf '    "uptime": "%s",\n' "$UPTIME_VALUE"
  printf '    "memory": "%s",\n' "$MEMORY_VALUE"
  printf '    "disk": "%s",\n' "$DISK_VALUE"
  printf '    "temperatureRaw": "%s",\n' "$TEMP_VALUE"
  printf '    "cpu": "%s"\n' "$CPU_VALUE"
  printf '  },\n'
  printf '  "backups": { "count": "%s" },\n' "$BACKUP_COUNT"
  printf '  "logs": [\n'
  FIRST=1
  printf '%s\n' "$LOG_LINES" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$FIRST" = "1" ]; then
      FIRST=0
    else
      printf ',\n'
    fi
    printf '    "%s"' "$line"
  done
  printf '\n  ],\n'
  printf '  "network": {\n'
  printf '    "connections": [\n'
  FIRST=1
  printf '%s\n' "$CONNECTION_LINES" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$FIRST" = "1" ]; then
      FIRST=0
    else
      printf ',\n'
    fi
    printf '      "%s"' "$line"
  done
  printf '\n    ]\n'
  printf '  }\n'
  printf '}\n'
} > "$TMP_FILE"

if command -v curl >/dev/null 2>&1; then
  echo "Homematic Analyzer: Sende Daten an den Analyzer ..."
  if curl --connect-timeout 5 --max-time 20 -fsS -H "Content-Type: application/json" -X POST --data-binary "@$TMP_FILE" -o "$RESPONSE_FILE" "$ENDPOINT"; then
    echo "Homematic Analyzer: Daten erfolgreich gesendet."
    if grep -q '"ok":true' "$RESPONSE_FILE" 2>/dev/null; then
      echo "Homematic Analyzer: Analyzer hat den Snapshot angenommen."
    else
      echo "Homematic Analyzer: Antwort vom Analyzer:"
      cat "$RESPONSE_FILE"
      echo
    fi
    echo "Homematic Analyzer: Fertig. Du kannst jetzt in der Web-App die Analyse starten."
  else
    echo "Homematic Analyzer: Fehler beim Senden an $ENDPOINT"
    if [ -s "$RESPONSE_FILE" ]; then
      echo "Homematic Analyzer: Antwort vom Analyzer:"
      cat "$RESPONSE_FILE"
      echo
    fi
    exit 1
  fi
else
  echo "curl wurde nicht gefunden. Payload liegt hier: $TMP_FILE"
  trap - EXIT INT TERM
  exit 1
fi
