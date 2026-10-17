# Homematic Analyzer CCU Add-on

Das CCU Add-on ist der empfohlene Weg, um Zusatzdaten direkt von der CCU/OpenCCU/RaspberryMatic an den Homematic Analyzer zu senden.

## Installation

1. Homematic Analyzer im Browser öffnen.
2. `Setup` öffnen.
3. `CCU Add-on installieren` öffnen und die Add-on-Datei herunterladen.
4. CCU WebUI öffnen: `Einstellungen → Systemsteuerung → Zusatzsoftware`.
5. Add-on-Datei hochladen und installieren.
6. Kurz warten und in der Analyse den Bereich `Datenquellen` prüfen.

## Was liefert das Add-on?

- Systemwerte der CCU: CPU, RAM, Temperatur, Speicher und Uptime
- Backup-Infos inklusive Backup-Pfad und letztem Backup; neben USB-Speichern werden auch auf der CCU eingehängte NFS- sowie SMB/CIFS-Freigaben durchsucht
- Logauszüge für lokale und optionale KI-Loganalyse
- aktive Verbindungen zu CCU-Diensten
- Gerätenamen und AskSin-kompatible Namensliste

## Muss der Sniffer trotzdem genutzt werden?

Nein. Der Sniffer bleibt optional. Ohne Sniffer analysiert die App CCU-/XML-API-Daten, Systemdaten und Logs. Der Sniffer ergänzt nur Funkdetails wie einzelne Telegramme, Funkzeit pro Gerät, Carrier Sense und RSSI am Sniffer-Standort.

## Entfernen

Das Add-on über `Systemsteuerung → Zusatzsoftware` deinstallieren. Es entfernt nur eigene Bridge-/Cron-Einträge und keine CCU-Geräte, Programme oder Backups.

## Fallback

Die alten Copy-Paste-Scripts bleiben vorerst für Sonderfälle vorhanden, sind aber nicht mehr der Standardweg.

### Backup auf zeitweise eingehängtem NAS

Die vollständige Vorlage kann im Analyzer unter `Setup → CCU Add-on installieren → NAS-Backup per Script einrichten` heruntergeladen werden. Vor der ersten Ausführung müssen darin NAS-Freigabe und Zugangsdaten eingetragen werden.

Wenn ein eigenes Backup-Skript ein NAS nur während des Backups unter `/mnt` einhängt, kann es nach dem Aushängen einen Status für den Analyzer hinterlegen. Das CCU Add-on zeigt danach Mountpoint, letztes Backup und zuletzt bekannten Speicherstand, obwohl die Freigabe wieder getrennt ist. Die Statusdatei gehört auf das persistente `/usr/local`.

Füge nach dem erfolgreichen Kopieren auf das NAS und **vor** `umount /mnt` ein:

```sh
BACKUP_STATUS_FILE="/usr/local/addons/homematic-analyzer-backup-status"
BACKUP_STATUS_TMP="${BACKUP_STATUS_FILE}.$$"
LATEST_BACKUP="$(ls -1t /mnt/*.sbk 2>/dev/null | head -n 1)"
{
  printf 'mountPoint=/mnt\n'
  printf 'latestPath=%s\n' "$LATEST_BACKUP"
  printf 'latestAt=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'disk=%s\n' "$(df -h /mnt 2>/dev/null | tail -n 1)"
} > "$BACKUP_STATUS_TMP" && mv "$BACKUP_STATUS_TMP" "$BACKUP_STATUS_FILE"
chmod 600 "$BACKUP_STATUS_FILE"
```

Die Datei enthält keine NAS-Zugangsdaten.
