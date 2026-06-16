#!/usr/bin/env bash
set -Eeuo pipefail

scripts=(
  scripts/install/install-linux.sh
  scripts/install/update-local.sh
  scripts/install/verify-installation.sh
  scripts/install/uninstall-linux.sh
  scripts/system-snapshot-collector.sh
)

for script in "${scripts[@]}"; do
  bash -n "$script"
  printf '[OK] Syntax: %s\n' "$script"
done

grep -q 'detect_existing_installation' scripts/install/install-linux.sh
grep -q 'npm ci wird übersprungen' scripts/install/update-local.sh
grep -q 'systemctl disable --now' scripts/install/uninstall-linux.sh
grep -q 'api/health' scripts/install/verify-installation.sh
grep -q 'Homematic Analyzer system snapshot' scripts/system-snapshot-collector.sh

printf '[OK] Installations-, Update-, Prüf- und Deinstallationspfade sind vorhanden.\n'
