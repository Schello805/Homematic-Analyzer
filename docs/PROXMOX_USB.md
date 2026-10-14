# Proxmox USB-Durchreichung für AskSin Analyzer XS

Der AskSin Analyzer XS Sniffer ist optional. Ohne Sniffer funktioniert die normale Homematic-/CCU-Analyse weiter. Für Funk-Tiefenanalyse muss der USB-Seriell-Port aber im Analyzer-System sichtbar sein.

Diese Anleitung beschreibt einen **Proxmox LXC**. Für eine VM ist USB-Passthrough meist direkt über die Proxmox-Weboberfläche einfacher.

## Ziel

Der Sniffer hängt am Proxmox-Host und wird in den LXC durchgereicht, in dem Homematic Analyzer läuft. Im Container soll anschließend ein Gerät wie `/dev/ttyUSB0`, `/dev/ttyACM0` oder ein stabiler Pfad unter `/dev/serial/by-id/` sichtbar sein.

## 1. Sniffer am Proxmox-Host finden

Auf dem Proxmox-Host ausführen:

```bash
lsusb
dmesg | grep -iE 'tty|usb|cp210|ch340|ftdi|acm'
ls -la /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
ls -la /dev/serial/by-id/ 2>/dev/null
```

Wenn möglich, notiere dir den stabilen Pfad unter `/dev/serial/by-id/`, z. B.:

```text
/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_A50285BI-if00-port0
```

Der stabile Pfad ist besser als `/dev/ttyUSB0`, weil sich `ttyUSB0` nach einem Neustart ändern kann.

## 2. Container-ID finden

```bash
pct list
```

Beispiel in dieser Anleitung: Container-ID `105`.

## 3. USB-Port als Gerät an den Container durchreichen

Der folgende Schritt wird **auf dem Proxmox-Host** ausgeführt, nicht in der Container-Konsole. Für unprivilegierte LXC ist die Proxmox-Gerätefreigabe `dev0` der zuverlässigste Weg: Sie setzt den Geräte-Node im Container mit den benötigten Rechten.

Container-Konfiguration bearbeiten:

```bash
nano /etc/pve/lxc/105.conf
```

### Variante A: `/dev/ttyUSB0`

Für viele USB-Seriell-Adapter wie FTDI/CH340/CP210x:

```ini
dev0: /dev/ttyUSB0,mode=0666
```

### Variante B: `/dev/ttyACM0`

Für ACM-Geräte:

```ini
dev0: /dev/ttyACM0,mode=0666
```

### Variante C: stabiler `/dev/serial/by-id/...` Pfad

Empfohlen, wenn der Pfad existiert:

```ini
dev0: /dev/serial/by-id/usb-FTDI_FT232R_USB_UART_A50285BI-if00-port0,mode=0666
```

Dann im Homematic Analyzer später diesen Port eintragen:

```text
/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_A50285BI-if00-port0
```

Es darf pro Container nur ein `dev0` geben. Wenn bereits Geräte durchgereicht werden, verwende stattdessen die nächste freie Nummer, etwa `dev1`.

## 4. Container neu starten

```bash
pct reboot 105
```

## 5. Im LXC prüfen

Auf dem Proxmox-Host prüfen:

```bash
pct exec 105 -- ls -l /dev/ttyUSB0
pct exec 105 -- timeout 2 cat /dev/ttyUSB0
```

Der zweite Befehl darf nicht `Permission denied` melden. Eine leere Ausgabe oder ein Timeout ist normal, wenn der Sniffer in diesem Moment keine Daten sendet.

Alternativ im Container einloggen:

```bash
pct enter 105
ls -la /dev/ttyUSB* /dev/ttyACM* /dev/serial/by-id/ 2>/dev/null
```

Wenn der Port sichtbar ist, im Homematic Analyzer unter `AskSin Analyzer XS USB-Port` eintragen, z. B.:

```text
/dev/ttyAskSinAnalyzer
```

oder:

```text
/dev/ttyUSB0
```

## 6. Berechtigungen prüfen

Falls der Port sichtbar ist, aber nicht geöffnet werden kann:

```bash
ls -la /dev/ttyUSB0 /dev/ttyAskSinAnalyzer 2>/dev/null
```

Bei `dev0` mit `mode=0666` ist das normalerweise nicht erforderlich. Bei einer anderen Freigabeart kann optional im Container gelten:

```bash
usermod -aG dialout homematic-analyzer
systemctl restart homematic-analyzer
```

Der Installer versucht die Gruppe `dialout` automatisch zu setzen, wenn während der Installation ein Sniffer-Port gewählt wurde.

## Troubleshooting

### Kein Gerät unter `/dev/ttyUSB*` oder `/dev/ttyACM*`

Auf dem Proxmox-Host prüfen:

```bash
dmesg | tail -n 80
lsusb
```

Wenn der Host nichts sieht, ist der Sniffer nicht korrekt verbunden oder der USB-Chip wird nicht erkannt.

### Gerät im Host sichtbar, aber nicht im LXC

- Ist der Eintrag `dev0: /dev/ttyUSB0,mode=0666` (oder der passende Pfad) in der **richtigen** `/etc/pve/lxc/<CTID>.conf` gespeichert?
- Container nach der Änderung wirklich neu gestartet (`pct reboot <CTID>`) ?
- Richtige Container-ID bearbeitet?
- Ist der Port auf dem Host sichtbar (`ls -l /dev/ttyUSB0`)?
- Meldet `pct exec <CTID> -- timeout 2 cat /dev/ttyUSB0` noch `Permission denied`? Dann ist die Gerätefreigabe noch nicht wirksam.

### Unprivileged LXC

Bei unprivileged Containern kann ein manueller `lxc.mount.entry` zu Rechteproblemen führen. Deshalb ist `dev0` mit `mode=0666` in dieser Anleitung der empfohlene Weg. Wenn es trotz korrektem Eintrag nicht klappt, sind die pragmatischen Optionen:

- privileged LXC für den Analyzer nutzen
- statt LXC eine kleine VM nutzen
- Analyzer direkt auf einem Raspberry betreiben

## Sicherheit

Der Sniffer-Port ist nur für lokale Analyse gedacht. Die CCU/WebUI sollte nicht per Portweiterleitung ins Internet gestellt werden. Für Zugriff von außen bitte VPN verwenden.
