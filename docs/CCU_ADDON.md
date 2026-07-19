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
- Backup-Infos inklusive Backup-Pfad und letztem Backup
- Logauszüge für lokale und optionale KI-Loganalyse
- aktive Verbindungen zu CCU-Diensten
- Gerätenamen und AskSin-kompatible Namensliste

## Muss der Sniffer trotzdem genutzt werden?

Nein. Der Sniffer bleibt optional. Ohne Sniffer analysiert die App CCU-/XML-API-Daten, Systemdaten und Logs. Der Sniffer ergänzt nur Funkdetails wie einzelne Telegramme, Funkzeit pro Gerät, Carrier Sense und RSSI am Sniffer-Standort.

## Entfernen

Das Add-on über `Systemsteuerung → Zusatzsoftware` deinstallieren. Es entfernt nur eigene Bridge-/Cron-Einträge und keine CCU-Geräte, Programme oder Backups.

## Fallback

Die alten Copy-Paste-Scripts bleiben vorerst für Sonderfälle vorhanden, sind aber nicht mehr der Standardweg.
