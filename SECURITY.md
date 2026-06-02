# Security Policy

## Unterstützte Versionen

Aktuell befindet sich Homematic Analyzer in einer frühen MVP-Phase. Sicherheitsmeldungen werden für den aktuellen Stand auf `main` angenommen.

## Sicherheitslücken melden

Bitte veröffentliche Sicherheitsprobleme nicht als öffentliches Issue.

Melde stattdessen vertraulich über GitHub Security Advisories, sobald das Repository diese Funktion nutzt, oder kontaktiere den Repository-Inhaber über GitHub.

## Sensible Daten

Homematic Analyzer soll keine Passwörter dauerhaft speichern. Trotzdem gilt:

- Keine echten CCU-, SSH- oder Telegram-Zugangsdaten in Issues posten.
- Keine kompletten Logs mit privaten Informationen veröffentlichen.
- Tokens und lokale Netzwerkdetails vor Screenshots oder Logs entfernen.

## Erwartung an Beiträge

Änderungen an Authentifizierung, Collector-Script, SSH, Telegram oder externen Schnittstellen sollten besonders sorgfältig geprüft und mit `npm run build` validiert werden.
