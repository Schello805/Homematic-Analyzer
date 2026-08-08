# Homematic Analyzer

> [!WARNING]
> **BETA-Software:** Das Projekt befindet sich aktiv in Entwicklung und ist noch nicht vollständig für einen unbeaufsichtigten Produktiveinsatz geeignet. Ergebnisse bitte gegen die CCU prüfen, vor Updates ein Backup erstellen und optionale Log-/Collector-Funktionen nur bewusst aktivieren.

Eine Web-App zur verständlichen Analyse von Homematic-, CCU3-, CCU2- und RaspberryMatic-Installationen.

## Idee

Der Analyzer arbeitet modular:

- **CCU-Zugang**: Basisanalyse für Geräte, Batterien, Servicemeldungen, Duty Cycle, Firmware und HmIP-Routing.
- **XML-API**: Erste echte CCU-Datenquelle für Geräte, Datenpunkte und Servicemeldungen.
- **CCU Add-on**: optionale Bridge für Systemwerte, Logs, Temperatur, Speicher, Backups, aktive CCU-Verbindungen und vorbereitete Gerätenamen.
- **KI-Logauswertung**: optional OpenAI oder Google Gemini nutzen, um vorhandene Logzeilen verständlich erklären zu lassen.
- **AskSin Analyzer XS**: optionale Funk-Tiefenanalyse für User mit vorhandenem Sniffer.
- **Telegram**: optionale Benachrichtigungen für kritische Events.
- **Externe Zugriffe**: aktive Gegenstellen zu CCU-Diensten erkennen, ohne ioBroker/Home Assistant nur anhand eines Textfelds zu erraten.
- **Firmware-Prüfung**: von der CCU gemeldete Geräte-Updates sowie neue OpenCCU-/RaspberryMatic- oder originale CCU3-Versionen erkennen.

Wichtig: Die App soll keine Fehler raten. Jede kritische Aussage braucht einen Beleg, zum Beispiel Messwert, Servicemeldung, Logzeile oder Gerätestatus.

## Quellenprinzip

Messwerte werden in der Oberfläche nach Quelle getrennt angezeigt:

- **CCU/XML-API**: bekannte Zentralenwerte wie Duty Cycle, Servicemeldungen, Batterien, Gerätezustände und RSSI aus Sicht der CCU.
- **AskSin-Sniffer**: optionale Zusatzmessung am Standort des Sniffers, z. B. einzelne Telegramme, geschätzte Funkzeit pro Gerät, Rauschpegel/Carrier Sense und Sniffer-RSSI.
- **CCU Add-on**: Systemzustand der Zentrale, Logs, Speicher, Backups und aktive Verbindungen.

Der Sniffer erklärt mögliche Verursacher und Funkumgebung, ersetzt aber nicht den bekannten CCU-WebUI-Duty-Cycle.

In der Analyse zeigt der Bereich **Datenquellen / Woher kommen die Ergebnisse?**, welche Quelle welchen Teil beiträgt und ob sie aktuell ist. So ist sichtbar, ob ein Hinweis aus der CCU, vom CCU Add-on oder optional vom Sniffer stammt.

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

Alle Fragen können übersprungen und später in der Web-App ausgefüllt werden. Gefundene USB-Ports werden automatisch angezeigt, bevorzugt als stabile Pfade unter `/dev/serial/by-id/`.
Auch in der Web-App kann der Sniffer-Port später per Dropdown neu gesucht und ausgewählt werden. Falls der Port nicht sichtbar ist, kann er weiterhin manuell eingetragen werden.

Systemwerte, Logs, Backups und vorbereitete Gerätenamen kommen künftig über das **Homematic Analyzer CCU Add-on**. Das Add-on wird nach der Analyzer-Installation in der Web-App heruntergeladen und anschließend in der CCU unter **Einstellungen → Systemsteuerung → Zusatzsoftware** installiert.

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

Installation anschließend nur lesend prüfen:

```bash
sudo bash /opt/homematic-analyzer/scripts/install/verify-installation.sh
```

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

Sensible Werte werden mit AES-256-GCM verschlüsselt. Der lokale Schlüssel liegt mit geschützten Dateirechten unter `.data/secret.key`. Unter **Einstellungen → Sicherung & Datenschutz** kann eine portable, passwortverschlüsselte Konfigurationsdatei exportiert und wiederhergestellt werden.

## XML-API Token-ID

Neuere XML-API-Versionen verlangen eine Token-ID per `sid`. Die Token-ID steht in `tokenlist.cgi` als Text zwischen `<token>` und `</token>` und wird im Analyzer ohne `@` eingetragen.

Beispiel:

```xml
<token desc="">DnBxgAKXiiGsvnn</token>
```

Dann im Analyzer nur die Token-ID eintragen, nicht das CCU-Passwort und nicht die komplette XML-Ausgabe.

### Benachrichtigungen optional aktivieren

Telegram, ntfy und E-Mail werden in der Settings-Seite unter **Benachrichtigungen** konfiguriert. Dort kann der User auch auswählen, bei welchen Ereignissen Benachrichtigungen gesendet werden sollen.

Für Telegram können alternativ weiterhin `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` als Umgebungsvariablen gesetzt werden, wenn keine Tokens im Browser gespeichert werden sollen.

### KI-Logauswertung optional aktivieren

In den Settings kann ein OpenAI- oder Gemini-API-Key hinterlegt werden. Die KI-Auswertung ist bewusst auf Logzeilen beschränkt; CCU-, SSH-, Telegram- und SMTP-Zugangsdaten werden dafür nicht an den KI-Anbieter gesendet.

## CCU Add-on Bridge

Nach der Analyzer-Installation kann in der Web-App ein Homematic-Add-on heruntergeladen werden. Dieses Add-on wird auf der CCU/OpenCCU/RaspberryMatic unter **Einstellungen → Systemsteuerung → Zusatzsoftware** installiert und erledigt die regelmäßige Übergabe automatisch.

Das Add-on liefert:

- CCU-Systemwerte wie CPU, RAM, Temperatur, Speicher und Uptime
- Backup-Ordner, Backup-Zeitpunkte und Backup-Speicher
- Logauszüge für die Loganalyse
- aktive Verbindungen zu typischen CCU-Diensten
- vorbereitete Gerätenamen und AskSin-kompatible Namensliste

Damit entfällt im normalen Workflow das manuelle Copy-Paste von CCU- oder Shell-Scripts. Die alten Script-Endpunkte bleiben vorerst als Fallback für Sonderfälle erhalten, werden aber nicht mehr als Standardweg empfohlen.

Entfernen: Das Add-on kann über **Systemsteuerung → Zusatzsoftware** wieder deinstalliert werden. Es entfernt dabei nur eigene Cron-/Bridge-Einträge.

Empfangene CCU-Daten werden lokal unter `.data/` gespeichert, damit sie nach einem Neustart des Analyzers erhalten bleiben.

## Funk-Topologie und Routing

Die HmIP-Routing-Analyse ist standardmäßig ausgeschaltet. Wird sie unter **Einstellungen → HmIP-Routing-Analyse** aktiviert, führt die App durch Log-Einstellung, Neustart und Collector-Test. Der Collector liest zusätzlich die HmIP-RF-Geräteparameter `ROUTER_MODULE_ENABLED`, `ENABLE_ROUTING` und `MULTICAST_ROUTER_MODULE_ENABLED` lokal und ausschließlich lesend aus.

Das Ergebnis erscheint anschließend automatisch unter **Analyse → Funk-Topologie** und kann zusätzlich über den Button **Routing-Grafik** geöffnet werden. Dort kann zwischen **HmIP**, **klassischem Homematic** und **Beides** gewechselt werden. Orange Punkte sind bei HmIP nur technisch geeignete, meist netzversorgte Kandidaten. Erst grüne Punkte sind durch CCU-Geräteparameter oder einen Routingbeleg als Router bestätigt.

Gateways werden nicht pauschal als Router behandelt: HmIP-Access-Points und klassische Homematic LAN-Gateways sind zusätzliche Funkempfänger. Ein klassisches LAN-Gateway bildet kein HmIP-Routingnetz. Wenn der konkret verwendete Empfänger eines Geräts nicht belegt ist, bleibt die Zuordnung in der Karte bewusst offen.

Die Analyseseite aktualisiert sich regelmäßig im Hintergrund. Ein manueller Neustart der Analyse ist im Normalfall nicht nötig; Datenquellen und Datenalter werden im Ergebnisbereich angezeigt.

Ausführliche bebilderte Anleitung: [`docs/HMIP_ROUTING.md`](docs/HMIP_ROUTING.md)

## DC-Analyzer und Gerätenamen

Der DC-Analyzer orientiert sich am AskSinAnalyzerXS: echte Sniffer-Telegramme werden vom seriellen Port gelesen, Duty-Cycle-Anteile werden aus Telegrammlänge und Flags berechnet und pro Funkadresse gruppiert.

Ein Sniffer ist optional. Ohne Sniffer liefert die CCU bereits Geräte-RSSI und Zustände aus Sicht der Zentrale. Der Sniffer ergänzt Informationen, die die CCU so nicht liefert: einzelne Telegramme, gemessene Sendezeit/Funklast pro Gerät, Carrier Sense beziehungsweise Rauschpegel und RSSI am Standort des Sniffers.

Unter **Einstellungen → AskSin-Sniffer** lässt sich die Erweiterung vollständig ein- oder ausschalten. Im ausgeschalteten Zustand verschwindet der DC-Analyzer aus der Navigation; Port und bisherige Einrichtung bleiben für eine spätere Reaktivierung gespeichert. Die normale Homematic-Analyse funktioniert weiterhin ohne Zusatzhardware.

Der Sniffer-Verlauf wird in echten Minutenwerten dargestellt. Hover oder Antippen zeigt Uhrzeit, Telegrammzahl, geschätzte Funkzeit und den gemessenen Rauschpegel in dBm. Überzählige Rohschätzungen werden proportional auf maximal 100 Prozent der verfügbaren Funkstunde normiert.

Für verständliche Gerätenamen nutzt der Analyzer die kompatible CCU-Systemvariable `AskSinAnalyzerDevList`, falls sie bereits vom AskSinAnalyzerXS vorhanden ist. Das CCU Add-on bereitet diese Namensliste zusätzlich vor, damit neue Nutzer kein separates WebUI-Script kopieren müssen.

## Aktueller Funktionsstand

Bereits umgesetzt:

- CCU/XML-API-Anbindung mit Token-ID/`sid`, Geräteauswertung und Servicemeldungen.
- CCU Add-on Bridge für Stammdaten, Gerätenamen, Systemwerte, Logs, Backups und aktive CCU-Verbindungen.
- Lokale Datenbank unter `.data/homematic-analyzer-db.json`.
- Telegram- und E-Mail-Benachrichtigungen inklusive auswählbarer Events.
- KI-Logauswertung mit OpenAI oder Google Gemini.
- Geräte-Firmwareupdates anhand der offiziellen CCU-Felder `AVAILABLE_FIRMWARE` und `FIRMWARE_UPDATE_STATE`; zusätzlich Hinweise bei unterschiedlichen Firmwareständen gleicher Gerätetypen.
- Zentralen-Updates für OpenCCU/RaspberryMatic über das offizielle OpenCCU-Repository und für die originale CCU3 über den offiziellen eQ-3-Update-Dienst. Ein Update wird nur behauptet, wenn die installierte Zentralenversion belegbar aus WebUI oder Collector gelesen wurde.
- Grafische Funk-Topologie für HmIP, klassisches Homematic und kombinierte Ansicht mit Kandidaten, Gateways, direkt gelesenen Router-/Routing-/Multicast-Schaltern, belegten Pfaden und verständlicher RSSI-Ampel.
- Erkennung aktiver externer Zugriffe auf typische CCU-Dienste anhand echter Verbindungsdaten.
- Proxmox-USB-Dokumentation und Installationsscript mit USB-Port-Scan.
- DC-Analyzer mit AskSin-kompatibler Telegramm-Auswertung, Duty-Cycle-Anteil pro Gerät und optionaler Namensauflösung über `AskSinAnalyzerDevList`.
- Status- und Diagnoseseite mit Datenalter, CCU-Verbindungstest und verständlichen Prüfschritten je Datenquelle.
- Lokale Analysehistorie mit erkennbaren Statusänderungen zwischen den letzten Analysen.
- Persistente Sniffer-Messpunkte für bis zu 30 Tage statt ausschließlich flüchtiger Momentaufnahmen.

Noch offen bzw. bewusst nur vorbereitet:

- Weitere reale HmIP-Routingpfade aus unterschiedlichen HmIPServer-Versionen und Logformaten ableiten.
- Weitere Geräte-Firmwarequellen ergänzen, falls ein Gerät seinen verfügbaren Stand nicht über die CCU-Gerätebeschreibung meldet.
- Externe Systeme wie ioBroker/Home Assistant nur dann konkret benennen, wenn Logs/API-Daten das belegen.
- Ausführlichere Langzeitdiagramme und Filter für die bereits gespeicherten Sniffer-Messpunkte.
- Hardwaretests auf weiteren CCU-/RaspberryMatic-/OpenCCU- und Proxmox-Versionen; die automatischen CI-Tests ersetzen keinen Test auf jeder realen Hardwarekombination.

## Dokumentation

- CCU Add-on Bridge: `docs/CCU_ADDON.md`
- Legacy CCU-Stammdaten-Script: `docs/CCU_MASTERDATA_SCRIPT.md`
- Legacy System-Snapshot: `docs/COLLECTOR_SCRIPT.md`
- XML-API Add-on: `docs/XML_API.md`
- AskSin Analyzer XS: `docs/ASKSIN_ANALYZER_XS.md`
- Proxmox USB-Durchreichung: `docs/PROXMOX_USB.md`
- HmIP-Routing vorbereiten und entfernen: `docs/HMIP_ROUTING.md`
- Sicherheit und Datenschutz: `docs/SECURITY_AND_PRIVACY.md`
- Produktiv- und Deinstallationscheckliste: `docs/PRODUCTION_CHECKLIST.md`

## GitHub

Repository: https://github.com/Schello805/Homematic-Analyzer
