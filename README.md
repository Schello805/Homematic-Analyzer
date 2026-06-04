# Homematic Analyzer

Eine Web-App zur verständlichen Analyse von Homematic-, CCU3-, CCU2- und RaspberryMatic-Installationen.

## Idee

Der Analyzer arbeitet modular:

- **CCU-Zugang**: Basisanalyse für Geräte, Batterien, Servicemeldungen, Duty Cycle, Firmware und HmIP-Routing.
- **XML-API**: Erste echte CCU-Datenquelle für Geräte, Datenpunkte und Servicemeldungen.
- **SSH oder Collector-Script**: Systemwerte, Logs, Temperatur, Speicher, Backups, aktive CCU-Verbindungen und belegbare Systemauffälligkeiten.
- **KI-Logauswertung**: optional OpenAI oder Google Gemini nutzen, um vorhandene Logzeilen verständlich erklären zu lassen.
- **AskSin Analyzer XS**: optionale Funk-Tiefenanalyse für User mit vorhandenem Sniffer.
- **Telegram**: optionale Benachrichtigungen für kritische Events.
- **Externe Zugriffe**: aktive Gegenstellen zu CCU-Diensten erkennen, ohne ioBroker/Home Assistant nur anhand eines Textfelds zu erraten.

Wichtig: Die App soll keine Fehler raten. Jede kritische Aussage braucht einen Beleg, zum Beispiel Messwert, Servicemeldung, Logzeile oder Gerätestatus.

## Installation auf Raspberry / Debian / Ubuntu / Proxmox LXC

Auf einem leeren Debian- oder Ubuntu-System kann der Analyzer automatisch installiert werden:

```bash
curl -fsSL https://raw.githubusercontent.com/Schello805/Homematic-Analyzer/main/scripts/install/install-linux.sh | sudo bash
```

Das Script installiert Node.js, klont dieses Repository nach `/opt/homematic-analyzer`, baut die App und richtet einen `systemd`-Service ein.

Nach der Installation ist die Web-App unter `http://SERVER-IP:3001` erreichbar.

Nützliche Befehle:

```bash
sudo systemctl status homematic-analyzer
sudo journalctl -u homematic-analyzer -f
sudo bash /opt/homematic-analyzer/scripts/install/install-linux.sh
```

Für Proxmox LXC reicht ein normaler Debian-/Ubuntu-Container. Für die CCU bitte keine Portweiterleitung verwenden; von außen besser per VPN zugreifen.

## Entwicklung starten

```bash
npm install
npm run dev
```

Frontend: `http://127.0.0.1:5173`

API: `http://127.0.0.1:3001`

Produktiver Einzelprozess nach `npm run build`:

```bash
npm start
```

## Lokale Datenbank

Der Analyzer speichert Settings und empfangene CCU-Stammdaten lokal in `.data/homematic-analyzer-db.json`. Die Datei wird atomar geschrieben und ist für die lokale Raspberry-/LAN-Nutzung bewusst ohne zusätzliche Datenbank-Abhängigkeit gehalten.

## XML-API Token-ID

Neuere XML-API-Versionen verlangen eine Token-ID per `sid`. Die Token-ID steht in `tokenlist.cgi` als Text zwischen `<token>` und `</token>` und wird im Analyzer ohne `@` eingetragen.

Beispiel:

```xml
<token desc="">DnBxgAKXiiGsvnn</token>
```

Dann im Analyzer nur die Token-ID eintragen, nicht das CCU-Passwort und nicht die komplette XML-Ausgabe.

### Benachrichtigungen optional aktivieren

Telegram und E-Mail werden in der Settings-Seite konfiguriert. Dort kann der User auch auswählen, bei welchen Ereignissen Benachrichtigungen gesendet werden sollen.

Für Telegram können alternativ weiterhin `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` als Umgebungsvariablen gesetzt werden, wenn keine Tokens im Browser gespeichert werden sollen.

### KI-Logauswertung optional aktivieren

In den Settings kann ein OpenAI- oder Gemini-API-Key hinterlegt werden. Die KI-Auswertung ist bewusst auf Logzeilen beschränkt; CCU-, SSH-, Telegram- und SMTP-Zugangsdaten werden dafür nicht an den KI-Anbieter gesendet.

## Collector-Script

In der App wird ein Copy-Paste-Befehl angezeigt. Das Script sammelt Systemwerte, relevante Logzeilen und aktive Verbindungen zu typischen CCU-Diensten auf der Zentrale und sendet sie an den Analyzer.

Beispiel:

```bash
curl -fsSL "http://127.0.0.1:3001/api/collector/script?url=http://127.0.0.1:3001&token=homematic-analyzer-demo-token" | sh
```

Empfangene CCU-Stammdaten werden lokal unter `.data/` gespeichert, damit sie nach einem Neustart des Analyzers erhalten bleiben.

## Nächste sinnvolle Schritte

- ReGa-Script auf echter CCU/RaspberryMatic gegenprüfen.
- Telegram-Events verfeinern, z. B. Batterie niedrig, Gerät nicht erreichbar, Sniffer getrennt und neue Zentralen-Releases.
- Firmware- und Zentralen-Releasevergleich ausbauen.
- HmIP-Routing-Topologie aus echten CCU-Daten ableiten.
- Externe Zugriffe mit Logs/Systemlast korrelieren und auffällige ioBroker/Home-Assistant-Pollingmuster verständlich erklären.
- AskSin Analyzer XS über seriellen Port anbinden.
- Proxmox-Anleitung für USB-Durchreichung dokumentieren.

## Dokumentation

- CCU-Stammdaten-Script: `docs/CCU_MASTERDATA_SCRIPT.md`
- Optionaler System-Snapshot: `docs/COLLECTOR_SCRIPT.md`
- XML-API Add-on: `docs/XML_API.md`
- AskSin Analyzer XS: `docs/ASKSIN_ANALYZER_XS.md`
- Proxmox USB-Durchreichung: `docs/PROXMOX_USB.md`

## GitHub

Repository: https://github.com/Schello805/Homematic-Analyzer
