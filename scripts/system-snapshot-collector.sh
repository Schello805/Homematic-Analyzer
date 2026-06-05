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
BACKUP_LIST_FILE="$(make_tmp_file backups)"
LOG_LIST_FILE="$(make_tmp_file logs)"
CONNECTION_LIST_FILE="$(make_tmp_file connections)"
: > "$TMP_FILE"
: > "$RESPONSE_FILE"
: > "$BACKUP_LIST_FILE"
: > "$LOG_LIST_FILE"
: > "$CONNECTION_LIST_FILE"

cleanup() {
  rm -f "$TMP_FILE" "$RESPONSE_FILE" "$BACKUP_LIST_FILE" "$LOG_LIST_FILE" "$CONNECTION_LIST_FILE"
}

trap cleanup EXIT INT TERM

install_cron_line() {
  interval="$1"
  case "$interval" in
    minute|minutely)
      cron_time="* * * * *"
      interval_text="minütlich"
      ;;
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
  awk 'BEGIN { first = 1 }
    {
      gsub(/\\/, "\\\\");
      gsub(/"/, "\\\"");
      gsub(/\r/, " ");
      gsub(/\t/, " ");
      if (!first) {
        printf " | ";
      }
      first = 0;
      printf "%s", $0;
    }'
}

value_or_empty() {
  sh -c "$1" 2>/dev/null | json_escape || true
}

read_cpu_percent() {
  if [ ! -r /proc/stat ]; then
    uptime 2>/dev/null | json_escape || true
    return
  fi

  read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat || return
  idle_one=$((idle + iowait))
  total_one=$((user + nice + system + idle + iowait + irq + softirq + steal))
  sleep 1
  read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat || return
  idle_two=$((idle + iowait))
  total_two=$((user + nice + system + idle + iowait + irq + softirq + steal))
  total_delta=$((total_two - total_one))
  idle_delta=$((idle_two - idle_one))

  if [ "$total_delta" -le 0 ]; then
    printf '0%%'
    return
  fi

  awk "BEGIN { printf \"%.0f%%\", (100 * ($total_delta - $idle_delta) / $total_delta) }"
}

UPTIME_VALUE="$(value_or_empty "uptime")"
MEMORY_VALUE="$(value_or_empty "free -m || top -bn1 | grep '^Mem:' | head -n 1")"
DISK_VALUE="$(value_or_empty "df -h /usr/local 2>/dev/null || df -h / 2>/dev/null || df -h | head -n 2")"
TEMP_VALUE="$(value_or_empty "cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || vcgencmd measure_temp 2>/dev/null | sed 's/[^0-9.]//g'")"
CPU_VALUE="$(read_cpu_percent)"
for backup_dir in /usr/local/backup /media /mnt /run/media /backup; do
  if [ -d "$backup_dir" ]; then
    find "$backup_dir" -type f 2>/dev/null | grep -Ei '(\.sbk$|\.tar\.gz$|\.tgz$|\.zip$)' >> "$BACKUP_LIST_FILE" 2>/dev/null || true
  fi
done
sort -u "$BACKUP_LIST_FILE" -o "$BACKUP_LIST_FILE" 2>/dev/null || true
BACKUP_COUNT="$(wc -l < "$BACKUP_LIST_FILE" 2>/dev/null | tr -d ' ')"
LATEST_BACKUP_PATH=""
LATEST_BACKUP_DIR=""
LATEST_BACKUP_AT=""
if [ -s "$BACKUP_LIST_FILE" ]; then
  LATEST_BACKUP_PATH="$(while IFS= read -r line; do [ -f "$line" ] && printf '%s\n' "$line"; done < "$BACKUP_LIST_FILE" | xargs ls -1t 2>/dev/null | head -n 1 || true)"
fi
if [ -n "$LATEST_BACKUP_PATH" ]; then
  LATEST_BACKUP_DIR="$(dirname "$LATEST_BACKUP_PATH" 2>/dev/null || true)"
  LATEST_BACKUP_AT="$(date -r "$LATEST_BACKUP_PATH" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || true)"
fi
BACKUP_DISK_VALUE=""
if [ -n "$LATEST_BACKUP_DIR" ]; then
  BACKUP_DISK_VALUE="$(df -h "$LATEST_BACKUP_DIR" 2>/dev/null | tail -n 1 | json_escape || true)"
else
  BACKUP_MOUNT="$(df -h 2>/dev/null | awk '$1 !~ /^tmpfs$/ && (index($6, "/media/") == 1 || index($6, "/mnt/") == 1 || index($6, "/run/media/") == 1) { print $6; exit }' || true)"
  if [ -n "$BACKUP_MOUNT" ]; then
    BACKUP_DISK_VALUE="$(df -h "$BACKUP_MOUNT" 2>/dev/null | tail -n 1 | json_escape || true)"
  fi
fi

echo "Homematic Analyzer: Systemwerte gesammelt."

{
  grep -iE "error|warn|unreach|lowbat|duty|carrier|hmip|rfd|rega|multimacd" /var/log/messages 2>/dev/null
  grep -iE "error|warn|unreach|lowbat|duty|carrier|hmip|rfd|rega|multimacd" /var/log/syslog 2>/dev/null
  journalctl -n 80 --no-pager 2>/dev/null | grep -iE "error|warn|unreach|lowbat|duty|carrier|hmip|rfd|rega|multimacd" 2>/dev/null
} | tail -n 25 > "$LOG_LIST_FILE" 2>/dev/null || true

{
  ss -Htanp 2>/dev/null
  netstat -tnp 2>/dev/null
  netstat -tn 2>/dev/null
} | grep -E ":(80|443|8181|2001|2010|9292|42001|42010|8700|8701)[[:space:]]" 2>/dev/null | head -n 80 > "$CONNECTION_LIST_FILE" 2>/dev/null || true

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
  printf '  "backups": { "count": "%s", "latestPath": "%s", "latestDirectory": "%s", "latestAt": "%s", "disk": "%s", "paths": [\n' \
    "$BACKUP_COUNT" \
    "$(printf '%s' "$LATEST_BACKUP_PATH" | json_escape)" \
    "$(printf '%s' "$LATEST_BACKUP_DIR" | json_escape)" \
    "$(printf '%s' "$LATEST_BACKUP_AT" | json_escape)" \
    "$BACKUP_DISK_VALUE"
  FIRST=1
  tail -n 8 "$BACKUP_LIST_FILE" 2>/dev/null | while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$FIRST" = "1" ]; then
      FIRST=0
    else
      printf ',\n'
    fi
    printf '    "%s"' "$(printf '%s' "$line" | json_escape)"
  done
  printf '\n  ] },\n'
  printf '  "logs": [\n'
  FIRST=1
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$FIRST" = "1" ]; then
      FIRST=0
    else
      printf ',\n'
    fi
    printf '    "%s"' "$(printf '%s' "$line" | json_escape)"
  done < "$LOG_LIST_FILE"
  printf '\n  ],\n'
  printf '  "network": {\n'
  printf '    "connections": [\n'
  FIRST=1
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$FIRST" = "1" ]; then
      FIRST=0
    else
      printf ',\n'
    fi
    printf '      "%s"' "$(printf '%s' "$line" | json_escape)"
  done < "$CONNECTION_LIST_FILE"
  printf '\n    ]\n'
  printf '  }\n'
  printf '}\n'
} > "$TMP_FILE"

if command -v curl >/dev/null 2>&1; then
  echo "Homematic Analyzer: Sende Daten an den Analyzer ..."
  HTTP_STATUS="$(curl --connect-timeout 5 --max-time 20 -sS -H "Content-Type: application/json" -X POST --data-binary "@$TMP_FILE" -o "$RESPONSE_FILE" -w "%{http_code}" "$ENDPOINT")" || HTTP_STATUS="000"
  if [ "$HTTP_STATUS" = "200" ]; then
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
    echo "Homematic Analyzer: Fehler beim Senden an $ENDPOINT (HTTP $HTTP_STATUS)"
    if [ -s "$RESPONSE_FILE" ]; then
      echo "Homematic Analyzer: Antwort vom Analyzer:"
      cat "$RESPONSE_FILE"
      echo
    else
      echo "Homematic Analyzer: Keine lesbare Antwort erhalten."
    fi
    DEBUG_PAYLOAD="/tmp/homematic-analyzer-last-payload.json"
    cp "$TMP_FILE" "$DEBUG_PAYLOAD" 2>/dev/null || true
    echo "Homematic Analyzer: Debug: Payload gespeichert unter $DEBUG_PAYLOAD"
    echo "Homematic Analyzer: Debug: Prüfen mit: cat $DEBUG_PAYLOAD"
    exit 1
  fi
else
  echo "curl wurde nicht gefunden. Payload liegt hier: $TMP_FILE"
  trap - EXIT INT TERM
  exit 1
fi
