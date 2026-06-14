# Sicherheit und Datenschutz

## Einsatzbereich

Der Homematic Analyzer ist für ein vertrauenswürdiges Heimnetz oder einen Zugriff per VPN gedacht. CCU, Analyzer und seine API dürfen nicht per Portweiterleitung öffentlich ins Internet gestellt werden.

## Zugangsdaten

- CCU-/SSH-Passwörter, XML-API-Token, Telegram-/SMTP-Secrets und KI-API-Keys werden in `.data/homematic-analyzer-db.json` mit AES-256-GCM verschlüsselt.
- Der lokale Schlüssel liegt unter `.data/secret.key`.
- Datenbank und Schlüssel erhalten Dateirechte `600`.
- Secrets werden nicht mehr dauerhaft im Browser-`localStorage` gespeichert.
- Wer Zugriff auf Analyzer-Prozess, Datenbank **und** Schlüsseldatei besitzt, kann die Secrets technisch entschlüsseln. Deshalb das Analyzer-System wie die CCU schützen.

## KI-Auswertung

Logs werden erst nach einem ausdrücklichen Klick an OpenAI oder Gemini übertragen. Im Modus „Nur Fehler und Warnungen“ erfolgt keine Anfrage, wenn der lokale Filter keine auffällige Zeile findet.

## Konfigurationsbackup

Das Backup unter **Einstellungen → Sicherung & Datenschutz** enthält Setup und Benachrichtigungseinstellungen einschließlich Secrets. Die Datei wird mit einem vom User vergebenen Passwort verschlüsselt. Messwerte, Logs und Analysehistorie sind nicht enthalten.

Das Backup-Passwort kann nicht wiederhergestellt werden. Backup-Datei und Passwort getrennt aufbewahren.

## Collector und Routing

Der Collector liest Systemwerte, definierte Logauszüge, Netzwerkverbindungen und Backup-Metadaten. Er verändert keine Homematic-Geräteparameter. Der HmIP-Routing-Collector liest Router-Schalter ausschließlich aus.

## Meldung einer Schwachstelle

Bitte Sicherheitsprobleme nicht mit echten Passwörtern, Tokens oder vollständigen privaten Logs in ein öffentliches Issue schreiben. Zuerst ein Issue ohne Secrets und mit anonymisierten Informationen erstellen.
