# XML-API Add-on

Homematic Analyzer nutzt aktuell die XML-API als erste echte Datenquelle für Geräte, Datenpunkte und Servicemeldungen.

Repository:

https://github.com/homematic-community/XML-API

Releases:

https://github.com/homematic-community/XML-API/releases

## Prüfung im Analyzer

Beim Start der Analyse prüft die App, ob `/addons/xmlapi/statelist.cgi` Daten liefert.

- **OK**: XML-API ist erreichbar und liefert Daten.
- **Kritisch**: CCU ist eingetragen, aber XML-API wurde nicht gefunden.
- **Nicht authentifiziert**: XML-API ist erreichbar, aber es fehlt ein gültiger `sid` Token.
- **Nicht möglich**: Es wurden noch keine CCU-Zugangsdaten eingetragen.

## Installation

1. Release-Datei aus dem XML-API-Repository herunterladen.
2. Homematic WebUI öffnen.
3. `Systemsteuerung` → `Zusatzsoftware` öffnen.
4. Add-on-Datei hochladen und installieren.
5. Zentrale neu starten.
6. Homematic Analyzer erneut ausführen.

## Token / sid einrichten

Neuere XML-API-Versionen nutzen einen eigenen Token. Das normale CCU-Passwort reicht dafür nicht.

1. Homematic WebUI öffnen.
2. `Systemsteuerung` → `Zusatzsoftware` öffnen.
3. Beim Add-on `XML-API` auf `Einstellen` klicken.
4. Einen Token registrieren oder eine vorhandene Token-ID aus `tokenlist.cgi` kopieren.
5. Token-ID im Analyzer im Feld `XML-API Token-ID / sid` eintragen. Die Token-ID wird ohne `@` gespeichert.

Alternativ kann im Host-Feld direkt eine XML-API-URL mit `sid` eingetragen werden, z. B. `http://CCU-IP/addons/xmlapi/statelist.cgi?sid=TOKEN_ID`.

## Warum als Voraussetzung?

Die XML-API liefert belegbare Daten. Dadurch kann der Analyzer Batterien, Erreichbarkeit, ausstehende Konfiguration und Servicemeldungen auswerten, ohne Probleme zu raten.
