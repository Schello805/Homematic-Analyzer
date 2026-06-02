#!/bin/sh
set -eu
umask 077

ANALYZER_URL="${ANALYZER_URL:-__ANALYZER_URL__}"
ANALYZER_TOKEN="${ANALYZER_TOKEN:-__ANALYZER_TOKEN__}"
ENDPOINT="$ANALYZER_URL/api/collector"
HOSTNAME_VALUE="$(hostname 2>/dev/null || echo unknown)"
COLLECTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"
TMP_FILE="$(mktemp /tmp/homematic-analyzer-payload.XXXXXX.json)"

cleanup() {
  rm -f "$TMP_FILE"
}

trap cleanup EXIT INT TERM

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

LOG_LINES="$(
  {
    grep -iE "error|warn|unreach|lowbat|duty|carrier|hmip|rfd|rega|multimacd" /var/log/messages 2>/dev/null
    grep -iE "error|warn|unreach|lowbat|duty|carrier|hmip|rfd|rega|multimacd" /var/log/syslog 2>/dev/null
    journalctl -n 80 --no-pager 2>/dev/null | grep -iE "error|warn|unreach|lowbat|duty|carrier|hmip|rfd|rega|multimacd" 2>/dev/null
  } | tail -n 25 | json_escape
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
  printf '\n  ]\n'
  printf '}\n'
} > "$TMP_FILE"

if command -v curl >/dev/null 2>&1; then
  curl --connect-timeout 5 --max-time 20 -fsS -H "Content-Type: application/json" -X POST --data-binary "@$TMP_FILE" "$ENDPOINT"
else
  echo "curl wurde nicht gefunden. Payload liegt hier: $TMP_FILE"
  trap - EXIT INT TERM
  exit 1
fi
