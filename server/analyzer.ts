import type { AnalysisCheck, AnalyzeRequest, CcuDevice, CcuSnapshot, CollectorPayload, Evidence } from "./types.js";

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

export function createAnalysis(config: AnalyzeRequest, collector?: CollectorPayload, ccu?: CcuSnapshot): AnalysisCheck[] {
  const hasCcuCredentials = Boolean(config.ccuHost && config.ccuUser && (config.ccuPassword || config.hasCcuPassword));
  const hasCcuData = Boolean(ccu?.reachable);
  const hasSsh = Boolean((config.sshHost || config.ccuHost || collector?.host) && (config.sshUser || collector));
  const hasSniffer = Boolean(config.snifferPort);
  const hasExternal = Boolean(config.externalSystems?.length);
  const ccuHostLooksPublic = Boolean(config.ccuHost && !isLocalOrPrivateHost(config.ccuHost));
  const lowBatteryDevices = ccu?.devices.filter((device) => device.lowBattery) ?? [];
  const unreachableDevices = ccu?.devices.filter((device) => device.unreachable) ?? [];
  const configPendingDevices = ccu?.devices.filter((device) => device.configPending) ?? [];
  const dutyStatus = dutyCycleStatus(ccu?.dutyCycle);

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
          : "Ohne CCU-Zugang kann die App keine Homematic-Geräte prüfen.",
      recommendation: hasCcuData
        ? "Die Basis steht. Für Systemwerte und Logs ergänze optional Collector oder SSH."
        : hasCcuCredentials
          ? "Prüfe Host, Benutzer, Passwort und ob die XML-API auf der CCU verfügbar ist."
          : "Trage Host, Benutzer und Passwort der CCU oder RaspberryMatic ein.",
      access: ["ccu"],
      evidence: hasCcuData
        ? [{ source: "CCU XML-API", detail: `${ccu?.counters.devices ?? 0} Geräte, ${ccu?.counters.serviceMessages ?? 0} Servicemeldungen gelesen.`, timestamp: ccu?.collectedAt }]
        : hasCcuCredentials && ccu?.error
          ? [{ source: "CCU XML-API", detail: ccu.error, timestamp: ccu.collectedAt }]
          : [],
      details: [
        "Die erste echte Datenquelle ist die XML-API der CCU/RaspberryMatic.",
        "Wenn sie nicht vorhanden ist, bleibt die Analyse transparent eingeschränkt."
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
      id: "service-messages",
      title: "Servicemeldungen",
      category: "Geräte",
      status: hasCcuData ? statusForCount(ccu?.counters.serviceMessages ?? 0) : "unavailable",
      summary: hasCcuData
        ? ccu?.counters.serviceMessages
          ? `${ccu.counters.serviceMessages} Servicemeldungen wurden gefunden.`
          : "Keine Servicemeldungen gefunden."
        : "Servicemeldungen können ohne CCU-Daten nicht geprüft werden.",
      recommendation: hasCcuData
        ? ccu?.counters.serviceMessages
          ? "Öffne die betroffenen Punkte und arbeite die Meldungen nacheinander ab."
          : "Kein Handlungsbedarf."
        : "CCU-Zugang und XML-API prüfen.",
      access: ["ccu"],
      evidence: ccu?.serviceMessages.slice(0, 8) ?? [],
      details: [
        "Servicemeldungen sind direkte Belege der Zentrale.",
        "Die App zeigt sie nicht als Vermutung, sondern als Quelle für konkrete Analysepunkte."
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
          ? "Wenn Duty Cycle wichtig ist, prüfe XML-API/Servicemeldungen oder ergänze später den passenden CCU-Datenpunkt."
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
        "Schwellwerte: ab 50% Verbesserung, ab 70% Hinweis, ab 90% kritisch.",
        "Ein Problem wird nur markiert, wenn ein echter Wert oder eine Servicemeldung vorliegt."
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
      status: hasCcuData ? statusForCount(unreachableDevices.length) : "unavailable",
      summary: hasCcuData
        ? unreachableDevices.length
          ? `${unreachableDevices.length} Geräte sind auffällig: ${deviceNames(ccu?.devices ?? [], (device) => device.unreachable)}.`
          : "Keine nicht erreichbaren Geräte gefunden."
        : "Erreichbarkeit kann ohne CCU-Daten nicht geprüft werden.",
      recommendation: hasCcuData
        ? unreachableDevices.length
          ? "Betroffene Geräte auf Strom/Batterie, Entfernung und Funkhindernisse prüfen."
          : "Kein Handlungsbedarf."
        : "CCU-Zugang einrichten, um nicht erreichbare Geräte nachweisbar zu erkennen.",
      access: ["ccu"],
      evidence: evidenceFromDevices(ccu?.devices ?? [], (device) => device.unreachable),
      details: [
        "Ausgewertet werden UNREACH/STICKY_UNREACH-Datenpunkte und passende Servicemeldungen.",
        "Ein Funkproblem wird daraus noch nicht automatisch geraten; dafür braucht es weitere Belege."
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
      status: hasCcuData || hasSniffer ? "improvement" : "unavailable",
      summary: hasSniffer
        ? "Mit Sniffer können Funktelegramme und schwache Verbindungen genauer eingeordnet werden."
        : hasCcuData
          ? "Die Basisdaten liegen vor; für Signalstärken braucht es später Sniffer- oder passende RSSI-Daten."
          : "Signalqualität braucht CCU-Daten oder optional den AskSin Analyzer XS.",
      recommendation: hasSniffer
        ? "AskSin Analyzer XS verbunden lassen, um Funkprobleme zeitlich besser zuzuordnen."
        : "Für eine tiefere Funkanalyse optional AskSin Analyzer XS anschließen.",
      access: hasSniffer ? ["sniffer"] : ["ccu"],
      evidence: [
        {
          source: hasSniffer ? "Sniffer-Konfiguration" : "Setup",
          detail: hasSniffer ? `USB-Port ${config.snifferPort} angegeben.` : "Sniffer nicht eingerichtet.",
          timestamp: now()
        }
      ],
      details: [
        "Die UI zeigt später normale Begriffe wie „gute Verbindung“, „schwach“ oder „kritisch“.",
        "Technische Werte bleiben auf Wunsch in den Details sichtbar."
      ]
    },
    {
      id: "routing-topology",
      title: "HmIP Routing",
      category: "Topologie",
      status: hasCcuData ? "improvement" : "unavailable",
      summary: hasCcuData
        ? "Gerätedaten liegen vor; Routing-Topologie wird als nächster Datenpunkt ergänzt."
        : "HmIP-Routing kann ohne CCU-Zugang nicht geprüft werden.",
      recommendation: hasCcuData
        ? "Router sollten bewusst platziert sein; auffällige Geräte werden mit nachvollziehbarem Beleg markiert."
        : "CCU-Zugang einrichten, um Routing-Informationen auszulesen.",
      access: ["ccu"],
      evidence: hasCcuData
        ? [{ source: "CCU XML-API", detail: `${ccu?.counters.devices ?? 0} Geräte als Grundlage gelesen.`, timestamp: ccu?.collectedAt }]
        : [],
      details: [
        "Diese Analyse erklärt, welche Geräte als Router dienen und wo Routing aktiv ist.",
        "Ein Problem wird nur markiert, wenn Daten oder Logs es stützen."
      ]
    },
    {
      id: "system-health",
      title: "Raspberry / Zentrale",
      category: "System",
      status: hasSsh ? "ok" : "unavailable",
      summary: hasSsh
        ? "Systemwerte wie RAM, CPU, Temperatur, Speicher und Backups können ausgewertet werden."
        : "Systemwerte brauchen SSH oder das Copy-Paste-Collector-Script.",
      recommendation: hasSsh
        ? "Behalte Temperatur, freien Speicher und Backup-Anzahl im Blick."
        : "SSH einrichten oder das Collector-Script auf der Zentrale ausführen.",
      access: ["ssh"],
      evidence: collector
        ? [{ source: "Collector-Script", detail: `Letzte Daten von ${collector.host ?? "unbekanntem Host"}.`, timestamp: collector.collectedAt ?? now() }]
        : hasSsh
          ? [{ source: "SSH-Setup", detail: `SSH-Ziel ${config.sshHost ?? config.ccuHost} wurde angegeben.`, timestamp: now() }]
          : [],
      details: [
        "Das Script sammelt nur messbare Werte und Logauszüge.",
        "Fehlende Befehle werden toleriert, damit auch CCU2/CCU3/RaspberryMatic möglichst sauber funktionieren."
      ]
    },
    {
      id: "logs",
      title: "Log-Auswertung",
      category: "Belege",
      status: collector?.logs?.length ? "warning" : hasSsh ? "improvement" : "unavailable",
      summary: collector?.logs?.length
        ? "Es liegen Logdaten vor. Auffälligkeiten können belegbar markiert werden."
        : hasSsh
          ? "Loganalyse ist vorbereitet und wartet auf echte Logdaten."
          : "Loganalyse ist ohne SSH oder Collector-Script nicht möglich.",
      recommendation: collector?.logs?.length
        ? "Kommunikationsfehler, Neustarts und Dienstprobleme werden in den Details mit Quelle angezeigt."
        : "Collector-Script ausführen, damit Logbelege in die Analyse einfließen.",
      access: ["ssh"],
      evidence: collector?.logs?.length
        ? collector.logs.slice(0, 5).map((line) => ({ source: "Log", detail: line, timestamp: collector.collectedAt ?? now() }))
        : [],
      details: [
        "Die App soll niemals aus Bauchgefühl urteilen: Jeder Fehler bekommt eine Quelle.",
        "Später werden bekannte Muster wie Kommunikationsstörung, Scriptfehler oder Dienstneustart automatisch gruppiert."
      ]
    },
    {
      id: "external-systems",
      title: "ioBroker / Home Assistant",
      category: "Anbindungen",
      status: hasExternal ? "improvement" : "unavailable",
      summary: hasExternal
        ? "Externe Systeme sind eingetragen und können später auf auffällige Zugriffe geprüft werden."
        : "Keine externen Systeme eingetragen.",
      recommendation: hasExternal
        ? "Bei Lastproblemen werden nur belegbare Hinweise aus Logs, Zugriffszahlen oder Systemlast angezeigt."
        : "Optional ioBroker oder Home Assistant eintragen, wenn sie mit der CCU sprechen.",
      access: ["external"],
      evidence: hasExternal
        ? [{ source: "Setup", detail: `Eingetragen: ${config.externalSystems?.join(", ")}`, timestamp: now() }]
        : [],
      details: [
        "Ziel ist: sichtbar machen, ob externe Systeme sehr häufig lesen oder schreiben.",
        "Ohne Beleg bleibt der Punkt neutral."
      ]
    },
    {
      id: "notifications",
      title: "Telegram Hinweise",
      category: "Benachrichtigung",
      status: config.telegramEnabled ? "ok" : "improvement",
      summary: config.telegramEnabled
        ? "Telegram-Benachrichtigungen sind für kritische Ereignisse vorgesehen."
        : "Telegram ist optional und noch nicht eingerichtet.",
      recommendation: "Sinnvolle Events: Duty Cycle kritisch, Batterie niedrig, Gerät nicht erreichbar, Konfiguration ausstehend, Sniffer getrennt, neue Releases.",
      access: ["telegram"],
      evidence: config.telegramEnabled
        ? [{ source: "Setup", detail: "Telegram aktiviert.", timestamp: now() }]
        : [],
      details: [
        "Benachrichtigungen sollten selten und relevant sein.",
        "Jede Meldung enthält den Grund und den Beleg, nicht nur einen Alarmtext."
      ]
    }
  ];

  return checks;
}
