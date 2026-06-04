# AskSin Analyzer XS

AskSin Analyzer XS ist die optionale Grundlage für die Funk-Tiefenanalyse.

Repository:

https://github.com/jp112sdl/AskSinAnalyzerXS

## Rolle im Homematic Analyzer

Homematic Analyzer soll auch ohne Sniffer nützlich sein. Der Sniffer erweitert die Analyse um genauere Funkbelege.

## Geplante Auswertung

- Funktelegramme zeitlich einordnen
- Signalqualität verständlich erklären
- auffällige Geräte anhand belegter Daten markieren
- Sniffer-Verbindung überwachen

## UX-Prinzip

Ohne Sniffer zeigt die App:

> Nicht möglich – kein Sniffer eingerichtet.

Mit Sniffer zeigt die App:

> Funk-Tiefenanalyse aktiv.

Der USB-Port kann in der Web-App per Dropdown ausgewählt werden. Bevorzugt werden stabile Pfade wie `/dev/serial/by-id/...`; falls Proxmox/LXC den Port anders durchreicht, bleibt eine manuelle Eingabe möglich.

Technische Details bleiben optional sichtbar.
