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

Falls `curl` noch nicht installiert ist:

```bash
sudo apt update
sudo apt install -y curl
```

```bash
curl -fsSL https://raw.githubusercontent.com/Schello805/Homematic-Analyzer/main/scripts/install/install-linux.sh | sudo bash
```

Das Script installiert Node.js, klont dieses Repository nach `/opt/homematic-analyzer`, baut die App und richtet einen `systemd`-Service ein.

Während der Installation fragt das Script optional nach:

- CCU-IP oder Host
- CCU-Benutzer
- XML-API Token-ID / `sid`
- AskSin Analyzer XS USB-Port
- ob Systemdaten per Collector gar nicht, einmalig, täglich oder stündlich an den Analyzer gesendet werden sollen

Alle Fragen können übersprungen und später in der Web-App ausgefüllt werden. Gefundene USB-Ports werden automatisch angezeigt, bevorzugt als stabile Pfade unter `/dev/serial/by-id/`.
Auch in der Web-App kann der Sniffer-Port später per Dropdown neu gesucht und ausgewählt werden. Falls der Port nicht sichtbar ist, kann er weiterhin manuell eingetragen werden.

Wenn der Collector während der Installation aktiviert wird, wartet das Script auf die lokale Analyzer-API und sendet direkt einen ersten System-Snapshot. Bei regelmäßiger Übertragung wird zusätzlich ein Cronjob auf dem System angelegt.

Nach der Installation ist die Web-App unter `http://SERVER-IP:3001` erreichbar.

Nützliche Befehle:

```bash
sudo systemctl status homematic-analyzer
sudo journalctl -u homematic-analyzer -f
sudo bash /opt/homematic-analyzer/scripts/install/install-linux.sh
```

## Updates

Die App prüft im Footer, ob auf GitHub ein neuer Stand verfügbar ist. Über `Update starten` kann eine lokale Installation aktualisiert werden. Dabei werden GitHub-Änderungen geladen, Abhängigkeiten installiert, die App neu gebaut und der Analyzer-Prozess neu gestartet.

Falls der Button nicht funktioniert oder du per SSH aktualisieren möchtest:

```bash
sudo bash /opt/homematic-analyzer/scripts/install/install-linux.sh
```

Alternativ direkt per GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/Schello805/Homematic-Analyzer/main/scripts/install/install-linux.sh | sudo bash
```

Falls Git auf einem bestehenden System `dubious ownership` meldet:

```bash
sudo git config --global --add safe.directory /opt/homematic-analyzer
```

Danach den Update-Befehl erneut ausführen.

Das Update-Log des Buttons liegt lokal unter `.data/update.log`.

## Versionierung

Die Version im Footer kommt automatisch aus `package.json`. Für Änderungen, die nach GitHub gepusht werden sollen, kann die Patch-Version automatisch erhöht werden:

```bash
npm run release:push
```

Das Script erhöht die Patch-Version, baut die App, erstellt einen Commit `Release x.y.z` und pusht anschließend nach GitHub.

Für Proxmox LXC reicht ein normaler Debian-/Ubuntu-Container. Wenn ein AskSin Analyzer XS Sniffer genutzt werden soll, muss der USB-Port vorher vom Proxmox-Host in den Container durchgereicht werden. Für die CCU bitte keine Portweiterleitung verwenden; von außen besser per VPN zugreifen.

Ausführliche Anleitung: [`docs/PROXMOX_USB.md`](docs/PROXMOX_USB.md)

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

## Aktueller Funktionsstand

Bereits umgesetzt:

- CCU/XML-API-Anbindung mit Token-ID/`sid`, Geräteauswertung und Servicemeldungen.
- CCU-WebUI/ReGa-Script für tägliche Stammdatenmeldung.
- Collector-Script für Systemwerte, Logs, Backups und aktive CCU-Verbindungen; einmalig oder per Cronjob.
- Lokale Datenbank unter `.data/homematic-analyzer-db.json`.
- Telegram- und E-Mail-Benachrichtigungen inklusive auswählbarer Events.
- KI-Logauswertung mit OpenAI oder Google Gemini.
- Firmware-Hinweise innerhalb der eigenen Installation, wenn gleiche Gerätetypen unterschiedliche Firmwarestände melden.
- HmIP-Routing-Hinweis auf Basis vorhandener Gerätedaten und möglicher Router-/Repeater-Kandidaten.
- Erkennung aktiver externer Zugriffe auf typische CCU-Dienste anhand echter Verbindungsdaten.
- Proxmox-USB-Dokumentation und Installationsscript mit USB-Port-Scan.

Noch offen bzw. bewusst nur vorbereitet:

- Echte AskSin Analyzer XS Live-Anbindung über seriellen Port; aktuell wird der Port nur erfasst/vorbereitet.
- Echte HmIP-Routing-Topologie aus HmIPServer-Daten oder belastbaren Logquellen ableiten.
- Online-Vergleich gegen neueste Geräte-, RaspberryMatic- oder CCU-Releases aus zuverlässigen Quellen.
- Externe Systeme wie ioBroker/Home Assistant nur dann konkret benennen, wenn Logs/API-Daten das belegen.
- Sniffer-getriebene Funkanalyse mit Telegrammzählung, Signalstärken und Carrier-Sense-Verlauf.

## Dokumentation

- CCU-Stammdaten-Script: `docs/CCU_MASTERDATA_SCRIPT.md`
- Optionaler System-Snapshot: `docs/COLLECTOR_SCRIPT.md`
- XML-API Add-on: `docs/XML_API.md`
- AskSin Analyzer XS: `docs/ASKSIN_ANALYZER_XS.md`
- Proxmox USB-Durchreichung: `docs/PROXMOX_USB.md`

## GitHub

Repository: https://github.com/Schello805/Homematic-Analyzer
