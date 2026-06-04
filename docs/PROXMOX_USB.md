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

## 3. Container stoppen

```bash
pct stop 105
```

## 4. LXC-Konfiguration bearbeiten

```bash
nano /etc/pve/lxc/105.conf
```

### Variante A: `/dev/ttyUSB0`

Für viele USB-Seriell-Adapter wie FTDI/CH340/CP210x:

```ini
lxc.cgroup2.devices.allow: c 188:* rwm
lxc.mount.entry: /dev/ttyUSB0 dev/ttyUSB0 none bind,optional,create=file
```

### Variante B: `/dev/ttyACM0`

Für ACM-Geräte:

```ini
lxc.cgroup2.devices.allow: c 166:* rwm
lxc.mount.entry: /dev/ttyACM0 dev/ttyACM0 none bind,optional,create=file
```

### Variante C: stabiler `/dev/serial/by-id/...` Pfad

Empfohlen, wenn der Pfad existiert:

```ini
lxc.cgroup2.devices.allow: c 188:* rwm
lxc.mount.entry: /dev/serial/by-id/usb-FTDI_FT232R_USB_UART_A50285BI-if00-port0 dev/ttyAskSinAnalyzer none bind,optional,create=file
```

Dann im Homematic Analyzer später diesen Port eintragen:

```text
/dev/ttyAskSinAnalyzer
```

Hinweis: Wenn dein Gerät intern `ttyACM` nutzt, kann statt `c 188:*` die Major-Nummer `166` nötig sein.

## 5. Container starten

```bash
pct start 105
```

## 6. Im LXC prüfen

Im Container einloggen:

```bash
pct enter 105
```

Dann prüfen:

```bash
ls -la /dev/ttyUSB* /dev/ttyACM* /dev/ttyAskSinAnalyzer 2>/dev/null
```

Wenn der Port sichtbar ist, im Homematic Analyzer unter `AskSin Analyzer XS USB-Port` eintragen, z. B.:

```text
/dev/ttyAskSinAnalyzer
```

oder:

```text
/dev/ttyUSB0
```

## 7. Berechtigungen prüfen

Falls der Port sichtbar ist, aber nicht geöffnet werden kann:

```bash
ls -la /dev/ttyUSB0 /dev/ttyAskSinAnalyzer 2>/dev/null
```

Optional im Container:

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

- Container wirklich gestoppt und neu gestartet?
- Richtige Container-ID bearbeitet?
- Major-Nummer passend?
  - `ttyUSB`: meist `188`
  - `ttyACM`: meist `166`
- Pfad in `lxc.mount.entry` exakt richtig?

### Unprivileged LXC

Bei unprivileged Containern kann USB-Passthrough je nach Proxmox-/Kernel-/LXC-Setup zickig sein. Wenn es trotz korrektem Eintrag nicht klappt, sind die pragmatischen Optionen:

- privileged LXC für den Analyzer nutzen
- statt LXC eine kleine VM nutzen
- Analyzer direkt auf einem Raspberry betreiben

## Sicherheit

Der Sniffer-Port ist nur für lokale Analyse gedacht. Die CCU/WebUI sollte nicht per Portweiterleitung ins Internet gestellt werden. Für Zugriff von außen bitte VPN verwenden.
