# Optionaler System-Snapshot

Dieses Shell-Script ist optional. Es sammelt Systemwerte der Zentrale oder des Raspberry und sendet sie an Homematic Analyzer.

Für tägliche CCU-Stammdaten gibt es ein eigenes WebUI/ReGa-Script: `docs/CCU_MASTERDATA_SCRIPT.md`.

## Was wird gesammelt?

- Hostname
- Zeitpunkt der Erfassung
- Uptime
- RAM-Auszug
- Speicherplatz auf `/`
- CPU-Auszug
- CPU-Temperatur, wenn verfügbar
- Anzahl gefundener Backups
- Relevante Logzeilen zu Fehlern, Warnungen, Funk, Batterien und Homematic-Diensten
- Aktive Verbindungen zu typischen CCU-Diensten wie WebUI, XML-API, BidCos-RPC und HmIP-RPC

## Was wird nicht gesammelt?

- Keine Passwörter
- Keine Telegram-Tokens
- Keine kompletten Logdateien
- Keine automatische Änderung an der CCU
- Keine Namen externer Systeme: ioBroker/Home Assistant werden nicht geraten, sondern nur IPs und Ports belegt angezeigt

## Ausführen

Der Befehl wird in der Web-App angezeigt:

```bash
curl -fsSL "http://ANALYZER/api/collector/script?url=http://ANALYZER&token=TOKEN" | sh
```

Die Web-App bietet drei Varianten:

- **Einmal jetzt senden**: sendet genau einen Snapshot.
- **Regelmäßig einrichten**: legt auf der Zentrale einen Cronjob an und sendet zusätzlich sofort einen Snapshot.
- **Regelmäßige Übertragung entfernen**: entfernt den vom Analyzer angelegten Cronjob wieder.

Der empfohlene Zyklus ist **täglich nachts**. Stündlich ist nur sinnvoll, wenn gerade aktiv nach Last-, Log- oder Verbindungsproblemen gesucht wird.

## Hinweis

Das Script toleriert fehlende Befehle, damit es auf CCU2, CCU3 und RaspberryMatic möglichst robust läuft.
