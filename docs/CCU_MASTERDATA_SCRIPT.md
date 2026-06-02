# CCU-Stammdaten-Script

Dieses Script wird in der Homematic WebUI als Programm-Script eingefügt und z. B. einmal täglich ausgeführt.

## Zweck

Die CCU bereitet Stammdaten vor und meldet sie an den Analyzer:

- Gerätenamen
- Geräteadressen
- Gerätetypen
- täglicher Laufzeitpunkt

Live-Werte wie Batterien, Erreichbarkeit, Duty Cycle, Firmwarestände und Servicemeldungen ruft der Analyzer weiterhin direkt über die XML-API ab.

## Angelegte Systemvariablen

- `HomematicAnalyzer_LastRun`
- `HomematicAnalyzer_Status`
- `HomematicAnalyzer_DeviceInventory`
- `HomematicAnalyzer_Error`

## Einrichtung

1. In der App den Bereich `Einmaliges Setup` öffnen.
2. `CCU-Script kopieren` klicken.
3. Homematic WebUI öffnen.
4. Ein neues Programm erstellen, z. B. täglich nachts.
5. Als Aktion `Script` wählen und den kopierten Inhalt einfügen.
6. Einmal manuell ausführen.

Danach liegt das Script in der CCU und stört im Analyzer nicht mehr.

## Feedback

Das Script nutzt `WriteLine`, damit beim manuellen Test sichtbar ist, was passiert:

- Variablen werden angelegt
- Geräte werden gesammelt
- Anzahl gefundener Geräte wird ausgegeben
- Sendeversuch an den Analyzer wird angezeigt
- Fehlerausgabe wird in `HomematicAnalyzer_Error` geschrieben
