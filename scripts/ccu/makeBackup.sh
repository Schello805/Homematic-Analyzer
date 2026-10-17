#!/bin/sh
# Homematic Analyzer: Vorlage fuer CCU-Backups auf ein zeitweise gemountetes NAS.
# Vor der ersten Ausfuehrung NAS_SHARE und SMB_OPTIONS anpassen.

NAS_SHARE="//192.168.1.118/Software/Homematic-Backups"
SMB_OPTIONS="vers=2.0,username=BENUTZER,password=PASSWORT"
MOUNT_POINT="/mnt"
BACKUP_DIRECTORY="/var/tmp"
BACKUP_STATUS_FILE="/usr/local/addons/homematic-analyzer-backup-status"
# Optional: eigene ntfy-URL eintragen. Leer lassen, wenn keine Meldung gewuenscht ist.
NOTIFY_URL=""

notify() {
  [ -n "$NOTIFY_URL" ] && /usr/bin/curl -d "$1" "$NOTIFY_URL" >/dev/null 2>&1
}

fail() {
  /bin/umount "$MOUNT_POINT" 2>/dev/null
  notify "Homematic Backup fehlgeschlagen: $1"
  echo "FEHLER: $1" >&2
  exit 1
}

/bin/umount -l "$MOUNT_POINT" 2>/dev/null
echo "Mounte Dateisystem"
/bin/mount -t cifs -o "$SMB_OPTIONS" "$NAS_SHARE" "$MOUNT_POINT" || fail "NAS konnte nicht gemountet werden"

echo "Erstelle Backup"
/bin/createBackup.sh "$BACKUP_DIRECTORY" || fail "Backup konnte nicht erstellt werden"
BACKUP_FILE="$(ls -1t "$BACKUP_DIRECTORY"/*.sbk 2>/dev/null | head -n 1)"
[ -n "$BACKUP_FILE" ] || fail "Keine .sbk-Datei erstellt"

echo "Kopiere Backup"
/bin/cp "$BACKUP_FILE" "$MOUNT_POINT" || fail "Backup konnte nicht auf das NAS kopiert werden"

# Dieser persistente Status wird vom Homematic Analyzer auch nach dem Aushaengen gelesen.
BACKUP_STATUS_TMP="${BACKUP_STATUS_FILE}.$$"
{
  printf 'mountPoint=%s\n' "$MOUNT_POINT"
  printf 'latestPath=%s\n' "$MOUNT_POINT/$(basename "$BACKUP_FILE")"
  printf 'latestAt=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'disk=%s\n' "$(df -h "$MOUNT_POINT" 2>/dev/null | tail -n 1)"
} > "$BACKUP_STATUS_TMP" && mv "$BACKUP_STATUS_TMP" "$BACKUP_STATUS_FILE"
chmod 600 "$BACKUP_STATUS_FILE"

echo "Loesche lokale Backup-Datei"
/bin/rm -f "$BACKUP_FILE"
echo "Unmounte Dateisystem"
/bin/umount "$MOUNT_POINT"
echo "Fertig."
notify "Homematic Backup erfolgreich erstellt."
