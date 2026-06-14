# Checkliste vor produktiver Nutzung

## Raspberry / Debian / Ubuntu

1. Installation ausführen.
2. `sudo bash /opt/homematic-analyzer/scripts/install/verify-installation.sh` starten.
3. Analyzer nur im Heimnetz oder per VPN erreichbar machen.
4. In der App ein verschlüsseltes Konfigurationsbackup erstellen.
5. CCU-Backup prüfen, bevor Updates oder Routing-Logging aktiviert werden.

## Proxmox LXC

1. Unprivilegierten Debian-/Ubuntu-LXC bevorzugen.
2. Netzwerkzugriff vom LXC zur CCU testen.
3. Nur bei aktiviertem Sniffer den USB-Port durchreichen.
4. Nach einem LXC-Neustart `verify-installation.sh` erneut ausführen.
5. Keine CCU- oder Analyzer-Ports am Router veröffentlichen.

## Update-Test

```bash
sudo bash /opt/homematic-analyzer/scripts/install/install-linux.sh
sudo bash /opt/homematic-analyzer/scripts/install/verify-installation.sh
```

Das Installationsscript erkennt vorhandene Installationen und fragt beim Update nicht erneut nach dem Erstsetup.

## Sichere Deinstallation

Service entfernen, Daten behalten:

```bash
sudo bash /opt/homematic-analyzer/scripts/install/uninstall-linux.sh
```

App, Konfiguration und Messdaten vollständig löschen:

```bash
sudo bash /opt/homematic-analyzer/scripts/install/uninstall-linux.sh --purge-data
```
