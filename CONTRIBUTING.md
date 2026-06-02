# Contributing

Danke, dass du Homematic Analyzer besser machen möchtest.

## Grundprinzipien

- Aussagen über Probleme müssen belegbar sein.
- Die Oberfläche soll für Normaluser verständlich bleiben.
- Technische Details sind erlaubt, aber nachrangig und aufklappbar.
- Sniffer, SSH, Telegram und externe Systeme sind optionale Erweiterungen.

## Lokal entwickeln

```bash
npm install
npm run dev
```

Frontend: `http://127.0.0.1:5173`

API: `http://127.0.0.1:3001`

## Vor einem Pull Request

Bitte ausführen:

```bash
npm run build
```

## Gute Issues

Hilfreich sind:

- Gerätetyp oder Zentralen-Version
- RaspberryMatic/CCU-Version
- Belegbare Logauszüge ohne Passwörter oder Tokens
- Erwartetes Verhalten
- Tatsächliches Verhalten

## Datenschutz

Bitte niemals Zugangsdaten, Tokens, IP-Adressen öffentlicher Systeme oder komplette Logdateien mit privaten Daten veröffentlichen.
