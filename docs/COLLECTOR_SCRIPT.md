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

## Was wird nicht gesammelt?

- Keine Passwörter
- Keine Telegram-Tokens
- Keine kompletten Logdateien
- Keine automatische Änderung an der CCU

## Ausführen

Der Befehl wird in der Web-App angezeigt:

```bash
curl -fsSL "http://ANALYZER/api/collector/script?url=http://ANALYZER&token=TOKEN" | sh
```

## Hinweis

Das Script toleriert fehlende Befehle, damit es auf CCU2, CCU3 und RaspberryMatic möglichst robust läuft.
