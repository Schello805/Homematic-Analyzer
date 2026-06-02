# Proxmox USB-Durchreichung für AskSin Analyzer XS

Priorität des Projekts ist der Betrieb auf einem Raspberry. Für Proxmox-Nutzer ist der Sniffer optional.

## Ziel

Der AskSin Analyzer XS wird per USB an den Proxmox-Host angeschlossen und an die VM oder den Container durchgereicht, in dem Homematic Analyzer läuft.

## Grober Ablauf

1. Sniffer am Proxmox-Host anschließen.
2. USB-Gerät auf dem Host identifizieren.
3. USB-Gerät an die VM durchreichen.
4. VM neu starten oder Gerät neu verbinden.
5. In der VM prüfen, ob ein Port wie `/dev/ttyUSB0` sichtbar ist.
6. Diesen Port im Homematic Analyzer eintragen.

## Typische Prüfkommandos

```bash
lsusb
dmesg | grep -i tty
ls -la /dev/ttyUSB*
```

## Wichtig

Die konkrete Proxmox-Konfiguration hängt von VM, Container, Host-Hardware und USB-Chip ab. Die App sollte fehlenden Sniffer-Zugriff deshalb immer als „Nicht möglich“ anzeigen und nicht als Fehler.
