# Homematic Analyzer

Eine Web-App zur verständlichen Analyse von Homematic-, CCU3-, CCU2- und RaspberryMatic-Installationen.

## Idee

Der Analyzer arbeitet modular:

- **CCU-Zugang**: Basisanalyse für Geräte, Batterien, Servicemeldungen, Duty Cycle, Firmware und HmIP-Routing.
- **XML-API**: Erste echte CCU-Datenquelle für Geräte, Datenpunkte und Servicemeldungen.
- **SSH oder Collector-Script**: Systemwerte, Logs, Temperatur, Speicher, Backups und belegbare Systemauffälligkeiten.
- **AskSin Analyzer XS**: optionale Funk-Tiefenanalyse für User mit vorhandenem Sniffer.
- **Telegram**: optionale Benachrichtigungen für kritische Events.
- **ioBroker / Home Assistant**: optionale Prüfung externer Anbindungen.

Wichtig: Die App soll keine Fehler raten. Jede kritische Aussage braucht einen Beleg, zum Beispiel Messwert, Servicemeldung, Logzeile oder Gerätestatus.

## Entwicklung starten

```bash
npm install
npm run dev
```

Frontend: `http://127.0.0.1:5173`

API: `http://127.0.0.1:3001`

## Collector-Script

In der App wird ein Copy-Paste-Befehl angezeigt. Das Script sammelt Systemwerte und relevante Logzeilen auf der Zentrale und sendet sie an den Analyzer.

Beispiel:

```bash
curl -fsSL "http://127.0.0.1:3001/api/collector/script?url=http://127.0.0.1:3001&token=homematic-analyzer-demo-token" | sh
```

## Nächste sinnvolle Schritte

- Echte CCU-Anbindung über XML-RPC/ReGa-Script implementieren.
- SSH-Ausführung sicher kapseln oder Collector als bevorzugten Weg nutzen.
- AskSin Analyzer XS über seriellen Port anbinden.
- Telegram-Bot-Konfiguration und Event-Regeln ergänzen.
- Proxmox-Anleitung für USB-Durchreichung dokumentieren.

## Dokumentation

- CCU-Stammdaten-Script: `docs/CCU_MASTERDATA_SCRIPT.md`
- Optionaler System-Snapshot: `docs/COLLECTOR_SCRIPT.md`
- XML-API Add-on: `docs/XML_API.md`
- AskSin Analyzer XS: `docs/ASKSIN_ANALYZER_XS.md`
- Proxmox USB-Durchreichung: `docs/PROXMOX_USB.md`

## GitHub

Repository: https://github.com/Schello805/Homematic-Analyzer
