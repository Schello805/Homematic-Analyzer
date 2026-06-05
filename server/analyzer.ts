import type { AnalysisCheck, AnalyzeRequest, CcuDevice, CcuMasterdataPayload, CcuSnapshot, CollectorPayload, Evidence, ReleaseCheck } from "./types.js";

const now = () => new Date().toISOString();
const xmlApiInstallUrl = "https://github.com/homematic-community/XML-API";

function normalizeHostForSecurity(host?: string): string {
  if (!host) return "";

  try {
    return new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`).hostname.toLowerCase();
  } catch {
    return host.split("/")[0]?.split(":")[0]?.toLowerCase() ?? "";
  }
}

function isPrivateIp(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;

  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254)
    || first === 127;
}

function isLocalOrPrivateHost(host?: string): boolean {
  const normalizedHost = normalizeHostForSecurity(host);

  if (!normalizedHost) return true;
  if (normalizedHost === "localhost") return true;
  if (normalizedHost.endsWith(".local")) return true;
  if (normalizedHost.endsWith(".fritz.box")) return true;
  if (normalizedHost.includes(":")) return normalizedHost === "::1" || normalizedHost.startsWith("fe80:");

  return isPrivateIp(normalizedHost);
}

function statusForCount(count: number, criticalAt = 1): "ok" | "critical" {
  return count >= criticalAt ? "critical" : "ok";
}

function evidenceFromDevices(devices: CcuDevice[], predicate: (device: CcuDevice) => boolean, max = 8): Evidence[] {
  return devices
    .filter(predicate)
    .flatMap((device) => device.evidence.length > 0
      ? device.evidence
      : [{ source: "CCU Gerätedaten", detail: `${device.name}: auffälliger Status wurde gemeldet.` }]
    )
    .slice(0, max);
}

function deviceNames(devices: CcuDevice[], predicate: (device: CcuDevice) => boolean): string {
  const names = devices.filter(predicate).map((device) => device.name).slice(0, 6);
  if (names.length === 0) return "";
  const suffix = devices.filter(predicate).length > names.length ? " …" : "";
  return `${names.join(", ")}${suffix}`;
}

function dutyCycleStatus(value: number | undefined): AnalysisCheck["status"] {
  if (value === undefined) return "unavailable";
  if (value >= 90) return "critical";
  if (value >= 70) return "warning";
  if (value >= 50) return "improvement";
  return "ok";
}

function dutyCycleText(value: number | undefined): string {
  return value === undefined ? "kein belegter Wert" : `${value}%`;
}

function collectorRecordValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

const ccuServicePorts = new Set(["80", "443", "8181", "2001", "2010", "9292", "42001", "42010", "8700", "8701"]);

const ccuServiceLabels: Record<string, string> = {
  "80": "WebUI/HTTP",
  "443": "WebUI/HTTPS",
  "8181": "XML-API/ReGa",
  "2001": "BidCos-RPC",
  "2010": "HmIP-RPC",
  "9292": "CUxD/XML-API",
  "42001": "HmIPServer",
  "42010": "HmIPServer",
  "8700": "ReGa/XML-RPC",
  "8701": "ReGa/XML-RPC"
};

type ExternalAccessCandidate = {
  host: string;
  count: number;
  ports: string[];
  isPublic: boolean;
  lines: string[];
};

type FirmwareDifference = {
  type: string;
  versions: string[];
  devices: string[];
};

type LogAnalysis = {
  relevantLines: string[];
  noisyLines: string[];
  status: AnalysisCheck["status"];
};

function analyzeLogLines(logs: string[] | undefined): LogAnalysis {
  const lines = logs?.map((line) => line.trim()).filter(Boolean) ?? [];
  const noisyLines = lines.filter((line) => /\b(debug|verbose)\b/i.test(line));
  const relevantLines = lines.filter((line) => {
    const isNoise = /\b(debug|verbose)\b/i.test(line);
    const isRelevant = /\b(error|err|fatal|panic|warn|warning|failed|failure|timeout|unreach|sticky_unreach|lowbat|service unavailable|segfault|restart|crash|critical)\b/i.test(line);
    return isRelevant && !isNoise;
  });
  const criticalLines = relevantLines.filter((line) => /\b(fatal|panic|segfault|crash|critical|service unavailable)\b/i.test(line));

  return {
    relevantLines,
    noisyLines,
    status: criticalLines.length > 0 ? "critical" : relevantLines.length > 0 ? "warning" : lines.length > 0 ? "ok" : "unavailable"
  };
}

function parseExternalAccesses(collector: CollectorPayload | undefined, ccuHost?: string): ExternalAccessCandidate[] {
  const lines = collector?.network?.connections ?? [];
  const ownHost = normalizeHostForSecurity(ccuHost);
  const grouped = new Map<string, { ports: Set<string>; lines: string[] }>();

  for (const line of lines) {
    const endpointMatches = [...line.matchAll(/((?:\d{1,3}\.){3}\d{1,3}|localhost):(\d{1,5})/g)];
    if (endpointMatches.length < 2) continue;

    const localPort = endpointMatches[0]?.[2];
    const remoteHost = endpointMatches[1]?.[1];
    if (!localPort || !remoteHost || !ccuServicePorts.has(localPort)) continue;
    if (remoteHost === "0.0.0.0" || remoteHost === "127.0.0.1" || remoteHost === "localhost" || remoteHost === ownHost) continue;

    const current = grouped.get(remoteHost) ?? { ports: new Set<string>(), lines: [] };
    current.ports.add(localPort);
    current.lines.push(line);
    grouped.set(remoteHost, current);
  }

  return [...grouped.entries()]
    .map(([host, value]) => ({
      host,
      count: value.lines.length,
      ports: [...value.ports].sort((firstPort, secondPort) => Number(firstPort) - Number(secondPort)),
      isPublic: !isLocalOrPrivateHost(host),
      lines: value.lines.slice(0, 4)
    }))
    .sort((firstCandidate, secondCandidate) => secondCandidate.count - firstCandidate.count);
}

function findFirmwareDifferences(masterdata: CcuMasterdataPayload | undefined, ccu: CcuSnapshot | undefined): FirmwareDifference[] {
  const devices = masterdata?.devices?.length
    ? masterdata.devices
    : ccu?.devices.map((device) => ({
      name: device.name,
      address: device.address,
      type: device.type,
      firmware: device.firmware
    })) ?? [];

  const byType = new Map<string, Array<{ name?: string; firmware?: string }>>();

  for (const device of devices) {
    if (!device.type || !device.firmware) continue;
    const current = byType.get(device.type) ?? [];
    current.push({ name: device.name ?? device.address, firmware: device.firmware });
    byType.set(device.type, current);
  }

  return [...byType.entries()]
    .map(([type, typeDevices]) => ({
      type,
      versions: [...new Set(typeDevices.map((device) => device.firmware).filter(Boolean) as string[])].sort(),
      devices: typeDevices.slice(0, 6).map((device) => `${device.name ?? "Unbenannt"} (${device.firmware})`)
    }))
    .filter((entry) => entry.versions.length > 1)
    .slice(0, 8);
}

function isReachabilityEvidence(evidence: Evidence): boolean {
  const detail = evidence.detail
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  return /unreach|nicht erreichbar|kommunikation|communication|geratekommunikation gestort/.test(detail);
}

export function createAnalysis(config: AnalyzeRequest, collector?: CollectorPayload, ccu?: CcuSnapshot, masterdata?: CcuMasterdataPayload, release?: ReleaseCheck): AnalysisCheck[] {
  const hasCcuCredentials = Boolean(config.ccuHost && config.ccuUser && (config.ccuPassword || config.hasCcuPassword));
  const hasCcuData = Boolean(ccu?.reachable);
  const hasSsh = Boolean((config.sshHost || config.ccuHost || collector?.host) && (config.sshUser || collector));
  const hasSniffer = Boolean(config.snifferPort);
  const hasNotifications = Boolean(config.notificationSettings?.telegram?.enabled || config.notificationSettings?.email?.enabled || config.telegramEnabled);
  const ccuHostLooksPublic = Boolean(config.ccuHost && !isLocalOrPrivateHost(config.ccuHost));
  const externalAccesses = parseExternalAccesses(collector, config.ccuHost);
  const publicExternalAccesses = externalAccesses.filter((access) => access.isPublic);
  const busyExternalAccesses = externalAccesses.filter((access) => access.count >= 8);
  const masterdataDeviceCount = masterdata?.deviceCount ?? masterdata?.devices?.length ?? 0;
  const inventoryDevices = masterdata?.devices?.length ? masterdata.devices : ccu?.devices ?? [];
  const hmipDevices = inventoryDevices.filter((device) => /^HmIP-/i.test(device.type ?? ""));
  const hmipRouterCandidates = hmipDevices.filter((device) => /(HAP|DRAP|WLAN|PSM|FSM|BSM|PCBS|WRC|MOD)/i.test(device.type ?? ""));
  const firmwareDifferences = findFirmwareDifferences(masterdata, ccu);
  const lowBatteryDevices = ccu?.devices.filter((device) => device.lowBattery) ?? [];
  const unreachableDevices = ccu?.devices.filter((device) => device.unreachable) ?? [];
  const unreachableServiceMessages = ccu?.serviceMessages.filter(isReachabilityEvidence) ?? [];
  const unreachableEvidence = unreachableDevices.length > 0
    ? evidenceFromDevices(ccu?.devices ?? [], (device) => device.unreachable)
    : unreachableServiceMessages.slice(0, 8);
  const unreachableCount = unreachableDevices.length || unreachableServiceMessages.length;
  const configPendingDevices = ccu?.devices.filter((device) => device.configPending) ?? [];
  const dutyStatus = dutyCycleStatus(ccu?.dutyCycle);
  const logAnalysis = analyzeLogLines(collector?.logs);
  const hasCcuSystemData = Boolean(masterdata?.system || masterdata?.backups);
  const systemSourceHost = collectorRecordValue(masterdata?.system, "host") ?? collector?.host ?? "unbekanntem Host";
  const systemTemperature = collectorRecordValue(masterdata?.system, "temperatureRaw") ?? collectorRecordValue(collector?.system, "temperatureRaw");
  const systemBackupCount = Number(collectorRecordValue(masterdata?.backups, "count") ?? collectorRecordValue(collector?.backups, "count") ?? "0");
  const systemMissingTemperature = Boolean((hasCcuSystemData || collector) && !systemTemperature);
  const systemMissingBackups = Boolean((hasCcuSystemData || collector) && systemBackupCount === 0);

  const checks: AnalysisCheck[] = [
    {
      id: "ccu-connection",
      title: "Zentrale erreichbar",
      category: "Grundlage",
      status: hasCcuData ? "ok" : hasCcuCredentials ? "critical" : "unavailable",
      summary: hasCcuData
        ? `${ccu?.counters.devices ?? 0} Geräte wurden über die CCU gelesen.`
        : hasCcuCredentials
          ? "Die Zugangsdaten sind eingetragen, aber die CCU-Daten konnten nicht gelesen werden."
          : "CCU-Zugang wurde noch nicht eingerichtet.",
      recommendation: hasCcuData
        ? "Die wichtigste Datenquelle funktioniert. Geräte, Servicemeldungen und viele Zustände können bewertet werden."
        : hasCcuCredentials
          ? "Prüfe Host, Benutzer, Passwort und ob die XML-API auf der CCU verfügbar ist."
          : "Im Setup Host, Benutzer, Passwort und XML-API-Token der CCU/RaspberryMatic eintragen.",
      access: ["ccu"],
      evidence: hasCcuData
        ? [{ source: "CCU XML-API", detail: `${ccu?.counters.devices ?? 0} Geräte, ${ccu?.counters.serviceMessages ?? 0} Servicemeldungen gelesen.`, timestamp: ccu?.collectedAt }]
        : hasCcuCredentials && ccu?.error
          ? [{ source: "CCU XML-API", detail: ccu.error, timestamp: ccu.collectedAt }]
          : [],
      details: [
        "Die XML-API ist die zentrale Quelle für Geräte, Servicemeldungen und Live-Zustände.",
        "Ohne diese Quelle bewertet der Analyzer keine Homematic-Probleme."
      ]
    },
    {
      id: "remote-exposure",
      title: "Zugriff von außen",
      category: "Sicherheit",
      status: ccuHostLooksPublic ? "critical" : config.ccuHost ? "ok" : "unavailable",
      summary: ccuHostLooksPublic
        ? "Der eingetragene CCU-Host sieht wie eine öffentliche Adresse oder Domain aus."
        : config.ccuHost
          ? "Der eingetragene CCU-Host sieht nach lokalem Netzwerk aus."
          : "Ohne CCU-Host kann kein Hinweis auf externe Erreichbarkeit geprüft werden.",
      recommendation: ccuHostLooksPublic
        ? "Keine Portweiterleitung zur CCU verwenden. Nutze stattdessen VPN, z. B. WireGuard, Tailscale oder den VPN-Zugang deines Routers."
        : config.ccuHost
          ? "Gut: Für die Analyse lokale IPs oder VPN-Adressen verwenden, nicht die CCU direkt ins Internet stellen."
          : "CCU-Host eintragen. Wenn du von außen zugreifen möchtest: VPN statt Portforwarding nutzen.",
      access: ["ccu"],
      evidence: config.ccuHost
        ? [{ source: "Setup", detail: `Eingetragener CCU-Host: ${normalizeHostForSecurity(config.ccuHost)}.` }]
        : [],
      details: [
        "Portforwarding kann die CCU/WebUI direkt aus dem Internet erreichbar machen.",
        "Der Analyzer kann Router-Regeln nicht sicher auslesen, erkennt aber verdächtige öffentliche Hosts.",
        "Empfehlung: VPN verwenden und die CCU nur im lokalen Netz oder über VPN erreichbar machen."
      ]
    },
    {
      id: "xml-api",
      title: "XML-API Add-on",
      category: "Grundlage",
      status: hasCcuData ? "ok" : hasCcuCredentials && ccu?.xmlApiInstalled === false ? "critical" : hasCcuCredentials ? "warning" : "unavailable",
      summary: hasCcuData
        ? "XML-API ist installiert und liefert Daten."
        : hasCcuCredentials && ccu?.xmlApiInstalled === false
          ? "XML-API wurde auf der Zentrale nicht gefunden."
          : hasCcuCredentials
            ? "XML-API konnte noch nicht eindeutig geprüft werden."
            : "XML-API wird geprüft, sobald CCU-Zugangsdaten eingetragen sind.",
      recommendation: hasCcuData
        ? "Kein Handlungsbedarf."
        : hasCcuCredentials && ccu?.xmlApiInstalled === false
          ? "Installiere das XML-API Add-on über die WebUI: Systemsteuerung → Zusatzsoftware → Add-on hochladen/installieren → CCU neu starten."
          : hasCcuCredentials
            ? "Prüfe Host, Login, Firewall und ob die XML-API unter /addons/xmlapi erreichbar ist."
            : "CCU-Zugangsdaten eintragen und Analyse starten.",
      access: ["ccu"],
      evidence: hasCcuData
        ? [{ source: "CCU XML-API", detail: "/addons/xmlapi/statelist.cgi hat Daten geliefert.", timestamp: ccu?.collectedAt }]
        : hasCcuCredentials && ccu?.error
          ? [{ source: "CCU XML-API", detail: ccu.error, timestamp: ccu.collectedAt, url: xmlApiInstallUrl }]
          : [],
      details: [
        "Download: https://github.com/homematic-community/XML-API/releases",
        "Installation: WebUI öffnen, Systemsteuerung → Zusatzsoftware, Add-on-Datei hochladen und installieren.",
        "Nach der Installation die Zentrale neu starten und die Analyse erneut ausführen."
      ]
    },
    {
      id: "ccu-masterdata",
      title: "CCU-Daten vorbereitet",
      category: "Grundlage",
      status: masterdataDeviceCount > 0 || hasCcuData ? "ok" : "unavailable",
      summary: masterdataDeviceCount > 0
        ? `${masterdataDeviceCount} Geräte wurden vom täglichen CCU-Script gemeldet.`
        : hasCcuData
          ? "Live-Gerätedaten wurden gelesen; das tägliche CCU-Script ist optional."
          : "Das tägliche CCU-Script wurde noch nicht empfangen.",
      recommendation: masterdataDeviceCount > 0
        ? "Gut: Gerätenamen und CCU-Systemwerte stehen unabhängig von Live-Abfragen bereit."
        : hasCcuData
          ? "Kein akuter Handlungsbedarf. Das Script verbessert nur die Stabilität der Stammdaten."
          : "CCU-Script einmal aus der App kopieren, in der WebUI ausführen und danach täglich laufen lassen.",
      access: ["ccu"],
      evidence: masterdataDeviceCount > 0
        ? [{ source: "CCU WebUI-Script", detail: `${masterdataDeviceCount} Geräte gemeldet.`, timestamp: masterdata?.collectedAt ?? now() }]
        : hasCcuData
          ? [{ source: "CCU XML-API", detail: `${ccu?.counters.devices ?? 0} Geräte wurden live gelesen.`, timestamp: ccu?.collectedAt }]
        : [],
      details: [
        "Stammdaten ändern sich selten und müssen nicht bei jeder Analyse live zusammengesucht werden.",
        "Live-Zustände wie Batterie, Erreichbarkeit und Duty Cycle holt der Analyzer weiter bei Bedarf direkt."
      ]
    },
    {
      id: "alarm-messages",
      title: "Alarmmeldungen",
      category: "Sicherheit",
      status: hasCcuData ? statusForCount(ccu?.counters.alarmMessages ?? 0) : "unavailable",
      summary: hasCcuData
        ? ccu?.counters.alarmMessages
          ? `${ccu.counters.alarmMessages} Alarmmeldungen wurden gefunden.`
          : "Keine Alarmmeldungen gefunden."
        : "Alarmmeldungen können ohne CCU-Daten nicht geprüft werden.",
      recommendation: hasCcuData
        ? ccu?.counters.alarmMessages
          ? "Alarmmeldungen zuerst prüfen und erst danach normale Servicemeldungen abarbeiten."
          : "Kein Handlungsbedarf."
        : "CCU-Zugang und XML-API prüfen.",
      access: ["ccu"],
      evidence: ccu?.alarmMessages.slice(0, 8) ?? [],
      details: [
        "Alarmmeldungen werden getrennt von normalen Servicemeldungen bewertet.",
        "Nur echte Alarmmeldungen der Zentrale werden als kritisch markiert.",
        "Wenn die XML-API keine Alarmmeldungen liefert, behauptet der Analyzer hier keinen Alarm."
      ]
    },
    {
      id: "service-messages",
      title: "Servicemeldungen",
      category: "Geräte",
      status: hasCcuData ? (ccu?.counters.serviceMessages ? "warning" : "ok") : "unavailable",
      summary: hasCcuData
        ? ccu?.counters.serviceMessages
          ? `${ccu.counters.serviceMessages} Servicemeldungen wurden gefunden.`
          : "Keine Servicemeldungen gefunden."
        : "Servicemeldungen können ohne CCU-Daten nicht geprüft werden.",
      recommendation: hasCcuData
        ? ccu?.counters.serviceMessages
          ? "Prüfe die Meldungen in Ruhe. Kritisch werden nur echte Alarmmeldungen bewertet."
          : "Kein Handlungsbedarf."
        : "CCU-Zugang und XML-API prüfen.",
      access: ["ccu"],
      evidence: ccu?.serviceMessages.slice(0, 8) ?? [],
      details: [
        "Servicemeldungen sind direkte Belege der Zentrale, aber nicht automatisch kritisch.",
        "Sie helfen bei der Ursachenfindung, z. B. Batterie, Kommunikation oder Konfiguration.",
        "Kritisch wird dieser Bereich erst über separate Alarmmeldungen oder belegte Einzelprüfungen."
      ]
    },
    {
      id: "duty-cycle",
      title: "Duty Cycle",
      category: "Funk",
      status: hasCcuData ? dutyStatus : "unavailable",
      summary: hasCcuData
        ? ccu?.dutyCycle === undefined
          ? "Es wurde kein belegter Duty-Cycle-Wert in den CCU-Daten gefunden."
          : `Der belegte Duty-Cycle-Wert liegt bei ${dutyCycleText(ccu.dutyCycle)}.`
        : "Duty Cycle kann ohne CCU-Daten nicht belegt werden.",
      recommendation: hasCcuData
        ? ccu?.dutyCycle === undefined
          ? "Kein Fehler wird behauptet. Der Analyzer zeigt Duty Cycle erst, wenn ein echter Wert oder eine passende Servicemeldung vorliegt."
          : ccu.dutyCycle >= 90
            ? "Kritisch: häufig sendende Programme, externe Systeme und Geräte mit Kommunikationsproblemen prüfen."
            : ccu.dutyCycle >= 70
              ? "Beobachten: Wenn der Wert länger hoch bleibt, Funklast und externe Abfragen prüfen."
              : "Kein akuter Handlungsbedarf."
        : "CCU-Zugang einrichten, damit der echte Duty-Cycle-Wert gelesen werden kann.",
      access: ["ccu"],
      evidence: hasCcuData && ccu?.dutyCycle !== undefined
        ? [{ source: "CCU XML-API", detail: `Duty Cycle: ${dutyCycleText(ccu.dutyCycle)}.`, timestamp: ccu.collectedAt }]
        : [],
      details: [
        "Schwellwerte: ab 50% Optimierung, ab 70% Hinweis, ab 90% kritisch.",
        "Ein Problem wird nur markiert, wenn ein echter Wert oder eine aktive Servicemeldung vorliegt."
      ]
    },
    {
      id: "batteries",
      title: "Batterien",
      category: "Geräte",
      status: hasCcuData ? statusForCount(lowBatteryDevices.length) : "unavailable",
      summary: hasCcuData
        ? lowBatteryDevices.length
          ? `${lowBatteryDevices.length} Geräte melden einen niedrigen Batteriestand: ${deviceNames(ccu?.devices ?? [], (device) => device.lowBattery)}.`
          : "Keine niedrigen Batteriestände gefunden."
        : "Batteriezustände sind ohne CCU-Daten nicht verfügbar.",
      recommendation: hasCcuData
        ? lowBatteryDevices.length
          ? "Batterien der genannten Geräte zeitnah tauschen und danach prüfen, ob die Meldung verschwindet."
          : "Kein Handlungsbedarf."
        : "CCU-Zugang einrichten, um niedrige Batterien nachweisbar zu erkennen.",
      access: ["ccu"],
      evidence: evidenceFromDevices(ccu?.devices ?? [], (device) => device.lowBattery),
      details: [
        "Ausgewertet werden LOWBAT/LOW_BAT/BATTERY_LOW-Datenpunkte und passende Servicemeldungen.",
        "Ohne belegten Status bleibt der Punkt OK oder nicht möglich."
      ]
    },
    {
      id: "reachability",
      title: "Erreichbarkeit",
      category: "Geräte",
      status: hasCcuData ? (unreachableCount > 0 ? "warning" : "ok") : "unavailable",
      summary: hasCcuData
        ? unreachableDevices.length
          ? `${unreachableDevices.length} Geräte sind auffällig: ${deviceNames(ccu?.devices ?? [], (device) => device.unreachable)}.`
          : unreachableServiceMessages.length
            ? `${unreachableServiceMessages.length} Erreichbarkeits-Servicemeldungen wurden gefunden.`
          : "Keine nicht erreichbaren Geräte gefunden."
        : "Erreichbarkeit kann ohne CCU-Daten nicht geprüft werden.",
      recommendation: hasCcuData
        ? unreachableCount
          ? "Betroffene Geräte auf Strom/Batterie, Entfernung und Funkhindernisse prüfen. Kritisch wird es erst bei Alarmmeldung oder wiederholter Störung."
          : "Kein Handlungsbedarf."
        : "CCU-Zugang einrichten, um nicht erreichbare Geräte nachweisbar zu erkennen.",
      access: ["ccu"],
      evidence: unreachableEvidence,
      details: [
        "Als Hinweis zählen aktive Servicemeldungen der Zentrale und zuordenbare Gerätebelege.",
        "Normale Servicemeldungen sind nicht automatisch kritisch.",
        "Historische UNREACH-/STICKY_UNREACH-Rohkanäle werden nicht mehr allein als aktueller Fehler gezählt."
      ]
    },
    {
      id: "config-pending",
      title: "Konfiguration ausstehend",
      category: "Geräte",
      status: hasCcuData ? (configPendingDevices.length > 0 ? "warning" : "ok") : "unavailable",
      summary: hasCcuData
        ? configPendingDevices.length
          ? `${configPendingDevices.length} Geräte haben ausstehende Konfiguration: ${deviceNames(ccu?.devices ?? [], (device) => device.configPending)}.`
          : "Keine ausstehende Gerätekonfiguration gefunden."
        : "Ausstehende Konfiguration kann ohne CCU-Daten nicht geprüft werden.",
      recommendation: hasCcuData
        ? configPendingDevices.length
          ? "Geräte gemäß Herstellerhinweis aufwecken oder bedienen, damit die Konfiguration übertragen wird."
          : "Kein Handlungsbedarf."
        : "CCU-Zugang einrichten, um ausstehende Konfiguration nachweisbar zu erkennen.",
      access: ["ccu"],
      evidence: evidenceFromDevices(ccu?.devices ?? [], (device) => device.configPending),
      details: [
        "Ausstehende Konfiguration kann Geräteverhalten verzögern oder Meldungen offen halten.",
        "Die App markiert diesen Punkt nur bei passendem Datenpunkt, Gerätelisteneintrag oder Servicemeldung."
      ]
    },
    {
      id: "signal-strength",
      title: "Signalqualität",
      category: "Funk",
      status: hasSniffer ? "improvement" : "unavailable",
      summary: hasSniffer
        ? "Mit Sniffer können Funktelegramme und schwache Verbindungen genauer eingeordnet werden."
        : hasCcuData
          ? "Keine belegbaren Signalstärken vorhanden. Die CCU-Daten reichen dafür aktuell nicht aus."
          : "Signalqualität braucht CCU-Daten oder optional den AskSin Analyzer XS.",
      recommendation: hasSniffer
        ? "AskSin Analyzer XS verbunden lassen, um Funkprobleme zeitlich besser zuzuordnen."
        : "Optional AskSin Analyzer XS anschließen. Ohne echte RSSI-/Snifferdaten wird hier kein Funkproblem behauptet.",
      access: hasSniffer ? ["sniffer"] : ["ccu"],
      evidence: hasSniffer ? [
        {
          source: "Sniffer-Konfiguration",
          detail: `USB-Port ${config.snifferPort} angegeben.`,
          timestamp: now()
        }
      ] : [],
      details: [
        "Dieser Punkt wird erst bewertet, wenn RSSI-Werte oder Snifferdaten vorliegen.",
        "Ohne Messwert bleibt der Punkt bewusst nicht geprüft."
      ]
    },
    {
      id: "routing-topology",
      title: "HmIP Routing",
      category: "Topologie",
      status: hmipDevices.length > 0 ? "unavailable" : hasCcuData || masterdataDeviceCount > 0 ? "ok" : "unavailable",
      summary: hmipDevices.length > 0
        ? `${hmipDevices.length} HmIP-Geräte gefunden. Aktive Routing-Pfade sind damit aber noch nicht belegbar.`
        : hasCcuData || masterdataDeviceCount > 0
          ? "Keine HmIP-Geräte in den verfügbaren Gerätedaten gefunden."
          : "HmIP-Routing kann ohne CCU-Daten oder Stammdaten nicht geprüft werden.",
      recommendation: hmipDevices.length > 0
        ? "Die Kandidatenliste hilft nur bei der Vorbereitung. Für echte Topologie braucht der Analyzer HmIPServer-Daten oder passende Logbelege."
        : hasCcuData || masterdataDeviceCount > 0
          ? "Kein Handlungsbedarf."
          : "CCU-Zugang oder tägliches Stammdaten-Script einrichten.",
      access: ["ccu"],
      evidence: hmipDevices.length > 0
        ? [{
          source: masterdataDeviceCount > 0 ? "CCU-Stammdaten" : "CCU XML-API",
          detail: `${hmipDevices.length} HmIP-Geräte erkannt. Mögliche Router-Kandidaten: ${hmipRouterCandidates.slice(0, 8).map((device) => `${device.name ?? device.address ?? "Unbenannt"} (${device.type})`).join(", ") || "keine"}. Das belegt noch keinen aktiven Routing-Pfad.`,
          timestamp: masterdata?.collectedAt ?? ccu?.collectedAt ?? now()
        }]
        : [],
      details: [
        "Die Kandidatenliste ist hilfreich, um grundsätzlich routingfähige Geräte zu erkennen.",
        "Diese Analyse unterscheidet bewusst zwischen möglichen Router-Geräten und wirklich aktivem Routing.",
        "Ein aktiver Routing-Pfad wird erst als Problem markiert, wenn HmIPServer-Daten oder Logs ihn belegen."
      ]
    },
    {
      id: "firmware-overview",
      title: "Geräte-Firmware",
      category: "Wartung",
      status: masterdataDeviceCount > 0 || hasCcuData
        ? firmwareDifferences.length > 0
          ? "warning"
          : "ok"
        : "unavailable",
      summary: masterdataDeviceCount > 0 || hasCcuData
        ? firmwareDifferences.length > 0
          ? `${firmwareDifferences.length} Gerätetypen laufen mit unterschiedlichen Firmwareständen.`
          : "Keine unterschiedlichen Firmwarestände innerhalb gleicher Gerätetypen gefunden."
        : "Firmware kann ohne CCU-Daten oder Stammdaten-Script nicht verglichen werden.",
      recommendation: masterdataDeviceCount > 0 || hasCcuData
        ? firmwareDifferences.length > 0
          ? "Prüfe die genannten Gerätetypen in der WebUI. Unterschiedliche Stände sind nicht immer falsch, aber ein guter Wartungshinweis."
          : "Kein Handlungsbedarf. Später ergänzt der Analyzer zusätzlich den Vergleich gegen verfügbare Hersteller-/Zentralen-Releases."
        : "CCU-Zugang oder tägliches Stammdaten-Script einrichten.",
      access: ["ccu"],
      evidence: firmwareDifferences.map((difference) => ({
        source: "Firmware-Vergleich",
        detail: `${difference.type}: Versionen ${difference.versions.join(", ")}; Beispiele: ${difference.devices.join(", ")}.`,
        timestamp: masterdata?.collectedAt ?? ccu?.collectedAt ?? now()
      })),
      details: [
        "Dieser Check vergleicht nur Geräte gleichen Typs innerhalb deiner Installation.",
        "Ein Online-Vergleich gegen neueste Hersteller-Firmware folgt separat, damit nichts geraten wird.",
        "Unterschiedliche Versionen sind ein Hinweis, aber nicht automatisch ein Fehler."
      ]
    },
    {
      id: "system-health",
      title: "Raspberry / Zentrale",
      category: "System",
      status: hasCcuSystemData || collector ? "ok" : "unavailable",
      summary: hasCcuSystemData
        ? `CCU-Systemwerte wurden vom WebUI-Script gelesen (${systemSourceHost}).`
        : collector
          ? `Systemwerte stammen vom Shell-Collector (${systemSourceHost}).`
        : hasSsh
          ? "SSH-Zugang ist eingetragen, aber es liegen noch keine Systemwerte vor."
        : "Systemwerte brauchen SSH oder das Copy-Paste-Collector-Script.",
      recommendation: hasCcuSystemData || collector
        ? systemMissingTemperature || systemMissingBackups
          ? "Wenn Temperatur oder Backups fehlen, das CCU-WebUI-Script einmal aktualisiert ausführen und prüfen, ob Backup-Dateien unter /usr/local/backup, /media oder /mnt liegen."
          : "Behalte Temperatur, freien Speicher und Backup-Anzahl im Blick."
        : hasSsh
          ? "CCU-WebUI-Script oder Shell-Collector ausführen, bevor Systemwerte bewertet werden."
        : "CCU-WebUI-Script einrichten. Das ist der bevorzugte Weg für CCU3/RaspberryMatic-Systemwerte.",
      access: ["ssh"],
      evidence: hasCcuSystemData
        ? [{ source: "CCU WebUI-Script", detail: `Systemvariablen der Zentrale gelesen. Temperatur: ${systemMissingTemperature ? "nicht verfügbar" : "vorhanden"}. Backups: ${systemBackupCount} gefunden.`, timestamp: masterdata?.collectedAt ?? now() }]
        : collector
          ? [{ source: "Shell-Collector", detail: `Fallback-Daten von ${systemSourceHost}. Temperatur: ${systemMissingTemperature ? "nicht verfügbar" : "vorhanden"}. Backups: ${systemBackupCount} gefunden.`, timestamp: collector.collectedAt ?? now() }]
        : hasSsh
          ? [{ source: "SSH-Setup", detail: `SSH-Ziel ${config.sshHost ?? config.ccuHost} wurde angegeben.`, timestamp: now() }]
          : [],
      details: [
        "Bevorzugte Quelle sind die HomematicAnalyzer-Systemvariablen, die das CCU-WebUI-Script auf der Zentrale erstellt.",
        "Der Shell-Collector ist nur Fallback oder Ergänzung für Logs und aktive Verbindungen.",
        "Bewertet werden nur Werte, die von der CCU/RaspberryMatic selbst geliefert wurden."
      ]
    },
    {
      id: "logs",
      title: "Log-Auswertung",
      category: "Belege",
      status: collector?.logs?.length ? logAnalysis.status : "unavailable",
      summary: collector?.logs?.length
        ? logAnalysis.relevantLines.length > 0
          ? `${logAnalysis.relevantLines.length} auffällige Logzeilen wurden gefunden.`
          : "Es liegen Logdaten vor, aber keine belegbaren Fehler-/Warnmuster."
        : hasSsh
          ? "Loganalyse ist vorbereitet, aber es liegen noch keine Logdaten vor."
          : "Loganalyse ist ohne SSH oder Collector-Script nicht möglich.",
      recommendation: collector?.logs?.length
        ? logAnalysis.relevantLines.length > 0
          ? "Prüfe die genannten Logzeilen. Nur diese werden als Auffälligkeit gewertet."
          : "Kein Handlungsbedarf aus diesen Logzeilen. Debug/Verbose-Ausgaben sind normale technische Protokolleinträge."
        : "Collector-Script ausführen, damit echte Logbelege in die Analyse einfließen.",
      access: ["ssh"],
      evidence: collector?.logs?.length
        ? (logAnalysis.relevantLines.length > 0 ? logAnalysis.relevantLines : logAnalysis.noisyLines).slice(0, 5).map((line) => ({
          source: logAnalysis.relevantLines.length > 0 ? "Auffällige Logzeile" : "Unauffällige Debug-/Verbose-Logzeile",
          detail: line,
          timestamp: collector.collectedAt ?? now()
        }))
        : [],
      details: [
        "Die App soll niemals aus Bauchgefühl urteilen: Jeder Fehler bekommt eine Quelle.",
        "Debug- und Verbose-Zeilen werden nicht als Fehler gewertet.",
        "Bekannte Muster wie Kommunikationsstörung, Scriptfehler oder Dienstneustart werden nur bei passenden Logbegriffen markiert."
      ]
    },
    {
      id: "external-access",
      title: "Externe Zugriffe auf die CCU",
      category: "Anbindungen",
      status: collector
        ? publicExternalAccesses.length > 0
          ? "critical"
          : busyExternalAccesses.length > 0
            ? "warning"
            : "ok"
        : "unavailable",
      summary: collector
        ? publicExternalAccesses.length > 0
          ? publicExternalAccesses.length === 1
            ? "1 öffentliche Gegenstelle ist aktiv mit CCU-Diensten verbunden."
            : `${publicExternalAccesses.length} öffentliche Gegenstellen sind aktiv mit CCU-Diensten verbunden.`
          : busyExternalAccesses.length > 0
            ? busyExternalAccesses.length === 1
              ? "1 lokales System hat viele gleichzeitige CCU-Verbindungen."
              : `${busyExternalAccesses.length} lokale Systeme haben viele gleichzeitige CCU-Verbindungen.`
            : externalAccesses.length > 0
              ? externalAccesses.length === 1
                ? "1 lokales System greift aktuell auf CCU-Dienste zu."
                : `${externalAccesses.length} lokale Systeme greifen aktuell auf CCU-Dienste zu.`
              : "Keine aktiven externen Zugriffe auf typische CCU-Dienste gefunden."
        : hasSsh
          ? "Der Check ist vorbereitet; es liegen aber noch keine Verbindungsdaten vom Collector vor."
          : "Ohne SSH oder Collector können externe Zugriffe nicht belegbar erkannt werden.",
      recommendation: collector
        ? publicExternalAccesses.length > 0
          ? "CCU nicht per Portweiterleitung veröffentlichen. Verbindung sofort prüfen und künftig VPN verwenden."
          : busyExternalAccesses.length > 0
            ? "Prüfe die genannten IPs: Häufig sind das ioBroker, Home Assistant oder eigene Scripts. Polling-Intervalle reduzieren und unnötige Schreibzugriffe vermeiden."
            : externalAccesses.length > 0
              ? "Ordne die IPs den Systemen zu. Erst wenn viele Verbindungen, Logs oder Lastspitzen zusammenpassen, wird daraus ein echtes Problem."
              : "Kein Handlungsbedarf."
        : "Collector-Script ausführen, damit aktive CCU-Verbindungen sichtbar werden.",
      access: ["ssh", "external"],
      evidence: externalAccesses.flatMap((access) => [
        {
          source: "Aktive Verbindung",
          detail: `${access.host}: ${access.count} Verbindung(en) zu ${access.ports.map((port) => ccuServiceLabels[port] ?? `Port ${port}`).join(", ")}.`,
          timestamp: collector?.collectedAt ?? now()
        },
        ...access.lines.map((line) => ({ source: "Verbindungszeile", detail: line, timestamp: collector?.collectedAt ?? now() }))
      ]).slice(0, 10),
      details: [
        "Dieser Check rät nicht, ob eine IP ioBroker oder Home Assistant ist.",
        "Er zeigt aktive Gegenstellen zu typischen CCU-Ports wie WebUI, XML-API, BidCos-RPC und HmIP-RPC.",
        "Viele gleichzeitige Verbindungen sind ein Hinweis, aber erst zusammen mit Logs oder hoher Last ein belastbarer Fehler.",
        "Öffentliche Gegenstellen sind kritisch: Die CCU sollte nicht per Portforwarding erreichbar sein."
      ]
    },
    {
      id: "notifications",
      title: "Benachrichtigungen",
      category: "Benachrichtigung",
      status: "ok",
      summary: hasNotifications
        ? "Benachrichtigungen sind für ausgewählte Ereignisse vorbereitet."
        : "Telegram und E-Mail sind optional und noch nicht eingerichtet.",
      recommendation: hasNotifications
        ? "Kein Handlungsbedarf."
        : "Nur einrichten, wenn du aktiv über kritische Ereignisse informiert werden möchtest.",
      access: ["telegram"],
      evidence: hasNotifications
        ? [{ source: "Settings", detail: "Mindestens ein Benachrichtigungskanal ist aktiviert.", timestamp: now() }]
        : [],
      details: [
        "Benachrichtigungen sollten selten und relevant sein.",
        "Jede Meldung enthält den Grund und den Beleg, nicht nur einen Alarmtext."
      ]
    }
  ];

  if (release) {
    checks.push({
      id: "app-release",
      title: "Analyzer Update",
      category: "Wartung",
      status: release.available ? "warning" : release.error ? "improvement" : "ok",
      summary: release.available
        ? `Neue Analyzer-Version verfügbar: ${release.latestVersion}.`
        : release.error
          ? "Release-Check konnte nicht vollständig durchgeführt werden."
          : "Keine neuere Analyzer-Version gefunden.",
      recommendation: release.available
        ? "Repository öffnen, Änderungen prüfen und Update bewusst installieren."
        : release.error
          ? "Internetverbindung oder GitHub-Erreichbarkeit prüfen."
          : "Kein Handlungsbedarf.",
      access: ["ccu"],
      evidence: [{
        source: "GitHub Release-Check",
        detail: release.available
          ? `Installiert: ${release.currentVersion}, neu: ${release.latestVersion}.`
          : release.error ?? `Installiert: ${release.currentVersion}.`,
        timestamp: release.checkedAt,
        url: release.url
      }],
      details: [
        "Dieser Check bezieht sich auf den Homematic Analyzer selbst.",
        "Zentralen-Releases für RaspberryMatic/CCU werden separat ergänzt, sobald eine zuverlässige Quelle angebunden ist."
      ]
    });
  }

  return checks;
}
