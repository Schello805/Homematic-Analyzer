# AskSin Analyzer XS / DC-Analyzer

Der DC-Analyzer ist optional. Die normale Homematic-Analyse funktioniert auch ohne Sniffer.

Referenzprojekt:

https://github.com/psi-4ward/AskSinAnalyzerXS

## Was der DC-Analyzer auswertet

- echte Sniffer-Telegramme vom seriellen Port, z. B. `/dev/ttyUSB0`
- RSSI pro Telegramm
- RSSI-Noise / Carrier-Sense-Zeilen, wenn der Sniffer sie liefert
- Duty-Cycle-Anteil pro Funkadresse
- Tabellenansicht nach Funklast

Die Berechnung orientiert sich an AskSinAnalyzerXS: Die Sendezeit wird aus Telegrammlänge und Flags berechnet. Ohne echte Telegramme wird kein Funkproblem behauptet.

## Gerätenamen

Sniffer-Telegramme enthalten Funkadressen, aber keine CCU-Gerätenamen. Für verständliche Namen nutzt der Analyzer die kompatible Systemvariable:

```text
AskSinAnalyzerDevList
```

Wenn AskSinAnalyzerXS bereits genutzt wurde, existiert diese Variable oft schon. Dann sendet das normale CCU-Stammdaten-Script sie automatisch an den Homematic Analyzer.

Wenn sie fehlt, zeigt der DC-Analyzer einen Hinweis und bietet ein Copy-Paste-WebUI-Script an. Dieses Script:

- legt `AskSinAnalyzerDevList` an, falls sie fehlt
- liest die Funkadresse aus `MetaData("DEVDESC")` / `RF_ADDRESS`
- schreibt die kompatible JSON-Struktur
- sendet die Geräteliste zusätzlich an den Homematic Analyzer

## Empfohlener Ablauf

1. Sniffer per USB anschließen.
2. In Proxmox/LXC den USB-Port durchreichen, falls nötig.
3. Im Setup oder DC-Analyzer den USB-Port wählen.
4. DC-Analyzer öffnen und `Sniffer prüfen` klicken.
5. Wenn Namen fehlen: `AskSin-Geräteliste Script kopieren`.
6. Script in der CCU-WebUI als Programm einfügen und ausführen.
7. Ein Homematic-Gerät auslösen und erneut prüfen.

## Hinweise

- Startmeldungen wie `ready`, `CC init` oder `AskSin++` zeigen nur, dass der Sniffer antwortet.
- Für die Tabelle braucht der Analyzer Telegrammzeilen im Format `:...;`.
- Wenn nur Funkadressen sichtbar sind, fehlt die passende `AskSinAnalyzerDevList`.
