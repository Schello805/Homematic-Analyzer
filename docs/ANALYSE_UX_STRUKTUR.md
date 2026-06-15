# Struktur der Analyseoberfläche

Die Analyse ist nach Aufgaben des Nutzers geordnet, nicht nach technischen Schnittstellen.

## Abgearbeitete Zusammenhänge

- Analysezeitpunkt, Datenalter und erneute Analyse stehen gemeinsam im Ergebnis-Kopf.
- Das System-Dashboard folgt direkt auf den Ergebnis-Kopf.
- CPU, RAM und Temperatur bilden den Bereich **Leistung**.
- Lokaler Speicher, USB-Speicher und Backups bilden den Bereich **Speicher & Backups**.
- Servicemeldungen und Erreichbarkeit werden als gemeinsamer Gerätezustand priorisiert.
- Duty Cycle, Signalqualität und Routing werden als gemeinsamer Funkzustand priorisiert.
- CCU-Verbindung, XML-API und Stammdaten erscheinen als nachvollziehbare Prüfkette.
- Firmware und Analyzer-Updates liegen gemeinsam unter **Wartung & Updates**.
- Logs und KI-Auswertung führen direkt auf dieselbe Logseite.
- Verwandte Prüfpunkte sind aus der Detailansicht direkt erreichbar.
- Statuskarten stehen unmittelbar vor den von ihnen gefilterten Prüfergebnissen.
- Unauffällige Detailprüfungen bleiben standardmäßig eingeklappt.

## Grundsatz

Die Oberfläche darf Zusammenhänge erklären, aber keine Ursache behaupten, die nicht durch CCU-Daten, Logs, Collector-Daten oder Snifferdaten belegt ist.
